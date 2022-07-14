"use strict"
const tracer = require('../tracer')("Multi-Azure-Fn-Backend-1")
const otel = require('@opentelemetry/api')
const { W3CTraceContextPropagator } = require("@opentelemetry/core")
const {
    defaultTextMapGetter, // back end should get headers from request
    defaultTextMapSetter,
    ROOT_CONTEXT,
    trace
} = otel

const { cleanHeaders, wait } = require("../util")

const axios = require("axios");
const backendApi = `https://multifndemo.azurewebsites.net/api/backend2`

module.exports = async function (context, req) {
    const headers = cleanHeaders(context, req.headers)
    const body = req.body
    const { requestIp, uuid } = body
    const parentSpan = tracer.startSpan("backend1request", {
        kind: otel.SpanKind.SERVER,
        attributes: {
            "invocationId": context.invocationId,
            "http.method": req.method,
            requestIp,
            uuid
        }
    })

    const propagator = new W3CTraceContextPropagator()
    let carrier = {}
    if (!headers.traceparent) {
        // add carrier to headers if they haven't been received
        carrier.traceparent ? headers.traceparent = carrier.traceparent : ""
        carrier.tracestate ? headers.tracestate = carrier.tracestate : ""
    } else {
        carrier.traceparent = headers.traceparent
    }

    trace.setSpanContext(ROOT_CONTEXT, parentSpan.spanContext())

    // extract the trace headers and make them available to the active context
    const ctx = propagator.extract(otel.context.active(), carrier, defaultTextMapGetter)

    // child span to give us some more measurements
    const span = tracer.startSpan("delayAndError", undefined, ctx)

    await wait(Math.floor(Math.random() * 2000)) // delay simulating work

    const delay = Math.floor(Math.random() * 3000) // delay for axios
    const shouldError = Math.floor(Math.random() * 20) === 1; // random error

    // Annotate our span to capture metadata about our operation.
    span.addEvent("choosing delay and error", {
        "invocationId": context.invocationId,
        "delay": delay,
        "shouldError": shouldError
    })

    let err = ""
    if (shouldError) {
        err = `This is an expected, though random, error.`
        context.log(err)
        console.error(err)
        throw new Error(err) // Unhandled errors get raised as errors
    }
    context.log(`ending delay span with delay of ${delay}`)
    span.end()
    // same here: we give this the context from the incoming request
    const requestSpan = tracer.startSpan("requestBackend2", undefined, ctx)

    // const backend1Hits = await db_increment_ip(requestIp, db)
    const backend1Hits = Math.floor(Math.random() * 1000) // ultimately we"ll store and increment

    const r = await axios.put(backendApi, {
        requestIp,
        uuid
    }, {
        headers,
        params: {
            delay
        }
    }).then(response => {
        // avoiding the response.request object with circular references
        context.log("response properties from backend 2", Object.keys(response))
        const {status, statusText, headers, data} = response
        const updatedData = {...data, backend1Hits}
        return {status, statusText, headers: cleanHeaders(context, headers), data: updatedData}
    }).catch(err => {
        context.log("Error in backend1 axios request", err)
        return { status: 500, statusText: "Bad request from frontend to backend" }
    })

    requestSpan.end()
    parentSpan.end()

    try {
        context.res = {
            headers: r && r.headers ? r.headers : headers,
            statusCode: shouldError ? 500 : r && r.status ? r.status : 502,
            body: shouldError ? JSON.stringify(err) : r && r.data ? JSON.stringify(r.data) : "No data from remote server."
        }
    } catch (e) {
        context.log("Error in trying to respond", err)
    }
}
