"use strict"

module.exports.cleanHeaders = (context, h) => {
    // context.log("ALL HEADERS", Object.keys(h))
    const props = [
        "traceparent", // if headers come in, we'll persist them.
        "tracestate",
        "content-type",
        "x-arr-log-id",
        "x-forwarded-proto",
        "x-appservice-proto",
        "x-arr-ssl",
        "x-forwarded-tlsversion",
        "x-forwarded-for",
        // "x-original-url",
        // "x-waws-unencoded-url",
        // "x-site-deployment-id",
        "was-default-hostname"
    ]
    const cleanHeaders = {}
    for (const i in props) {
        const p = props[i]
        if (h && h[p]) {
            cleanHeaders[p] = h[p]
        }
    }
    return cleanHeaders
}

module.exports.wait = ms => new Promise(res => setTimeout(res, ms))
