"use strict";
const tracer = require('../tracer')("Multi-Azure-Fn-Backend-2")
const otel = require('@opentelemetry/api')
const { W3CTraceContextPropagator } = require("@opentelemetry/core")
const {
    defaultTextMapGetter, // back end should get headers from request
    ROOT_CONTEXT,
    trace
} = otel

const { cleanHeaders, wait } = require("../util")

module.exports = async function (context, req) {
    const headers = cleanHeaders(context, req.headers)
    let requestIp
    let uuid
    let body
    if (req.body && typeof req.body === "string") {
        body = JSON.parse(req.body)
    } else if (req.body) {
        body = req.body
    }
    if (body && body.requestIp) {
        requestIp = body.requestIp
        uuid = body.uuid
    } else {
        requestIp = "unknown"
        uuid = ""
    }

    const parentSpan = tracer.startSpan('backend2', {
        kind: otel.SpanKind.SERVER,
        attributes: {
            "invocationId": context.invocationId,
            "http.method": req.method,
            requestIp,
            uuid
        },
        // context: w3cContext
    })

    trace.setSpanContext(ROOT_CONTEXT, parentSpan.spanContext())

    const propagator = new W3CTraceContextPropagator()
    let carrier = {}

    if (!headers.traceparent) {
        // add carrier to headers if they haven't been received
        carrier.traceparent ? headers.traceparent = carrier.traceparent : ""
        carrier.tracestate ? headers.tracestate = carrier.tracestate : ""
    } else {
        carrier.traceparent = headers.traceparent
    }

    const ctx = propagator.extract(otel.context.active(), carrier, defaultTextMapGetter)

    const delay = Math.floor(Math.random() * 10000)

    // // Start another span. In this example, the async function method already started a
    // // parentSpan, so that will be the parent span, and this will be a child span.
    const span = tracer.startSpan("delayAndError", undefined, ctx)

    await wait(Math.floor(Math.random() * 4000))
    const shouldError = Math.floor(Math.random() * 10) === 1;

    // Annotate our span to capture metadata about our operation.
    span.addEvent("choosing delay and error", {
        "invocationId": context.invocationId,
        "delay": delay,
        "shouldError": shouldError
    })

    let err = ''

    if (shouldError) {
        err = `This is an expected, though random, error.`
        context.log(err)
        throw new Error(err) // Unhandled errors get raised as errors
    }
    context.log(`ending delay span with delay of ${delay}`)
    span.end()

    const responseSpan = tracer.startSpan("backend2response", undefined, ctx)
    //const backend2hits = await dynamodb_increment_ip(requestIp, dynamoDb)
    const backend2hits = Math.floor(Math.random() * 1000)

    const response = { ...body, backend2hits, requestIp, uuid, traceparent: headers.traceparent, tracestate: headers.tracestate }

    const finalResponse = {
        headers: cleanHeaders(context, headers),
        statusCode: shouldError ? 500 : 200,
        body: shouldError ? JSON.stringify(err) : JSON.stringify(response)
    }

    responseSpan.end()
    parentSpan.end()

    context.res = finalResponse
}
