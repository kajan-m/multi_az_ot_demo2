"use strict";
const tracer = require("../tracer")("Multi-Azure-Fn-Frontend")
const otel = require("@opentelemetry/api")
const { W3CTraceContextPropagator } = require("@opentelemetry/core")
const {
    defaultTextMapGetter,
    defaultTextMapSetter, // only setting for this front end
    ROOT_CONTEXT,
    trace
} = otel

const { cleanHeaders, wait } = require("../util")
const axios = require("axios")
const { v4: uuidv4 } = require("uuid")
const backendApi = `https://multifndemo.azurewebsites.net/api/backend1`

module.exports = async function (context, req) {
    const headers = cleanHeaders(context, req.headers)
    const requestIp = headers["x-forwarded-for"]
    const uuid = uuidv4()
    const parentSpan = tracer.startSpan("frontEndRequest", {
        kind: otel.SpanKind.CONSUMER,
        attributes: {
            "invocationId": context.invocationId,
            "http.method": req.method,
            requestIp,
            uuid
        },
        // context: w3cContext
    })

    const propagator = new W3CTraceContextPropagator()
    let carrier = {}

    propagator.inject(
        trace.setSpanContext(ROOT_CONTEXT, parentSpan.spanContext()),
        carrier,
        defaultTextMapSetter
    )

    if (!headers.traceparent) {
        // add carrier to headers if they haven't been received
        carrier.traceparent ? headers.traceparent = carrier.traceparent : ""
        carrier.tracestate ? headers.tracestate = carrier.tracestate : ""
    }

    // Start another span. In this example, the async function method already started a
    // parentSpan, so that will be the parent span, and this will be a child span.
    const ctx = otel.trace.setSpan(otel.context.active(), parentSpan)
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
        throw new Error(err) // Unhandled errors get raised as errors
    }

    span.end()
    const requestSpan = tracer.startSpan("requestBackend1", undefined, ctx)

    // const frontEndHits = await db_increment_ip(requestIp, db)
    const frontEndHits = Math.floor(Math.random() * 1000) // ultimately we"ll store and increment

    const r = await axios.put(backendApi, {
        requestIp,
        uuid
    }, {
        headers,
        params: {
            delay
        }
    }).then(response => {
        context.log("frontend got axios response")
        // avoiding the response.request object with circular references
        context.log("response properties", Object.keys(response))
        const {status, statusText, headers, data} = response
        const updatedData = {...data, frontEndHits}
        return {status, statusText, headers, data: updatedData}
    }).catch(err => {
            context.log("Error in frontend axios request", err)
            return {
                status: 500,
                statusText: "Bad request from frontend to backend"
            }
        }
    )

    requestSpan.end()
    parentSpan.end()
    try {
        const response = {
            headers: r && r.headers ? r.headers : headers,
            statusCode: shouldError ? 500 : r && r.status ? r.status : 502,
            body: shouldError ? JSON.stringify(err) : r && r.data ? JSON.stringify(r.data) : "No data from remote server."
        }
        context.log("response", response)
        context.res = response
    } catch (e) {
        context.log("Error in trying to respond", err)
    }
}
