'use strict'

const Tracer = require('opentracing').Tracer
const ScopeManager = require('../scope/noop/scope_manager')
const Scope = require('../noop/scope')
const Span = require('./span')

class NoopTracer extends Tracer {
  constructor (config) {
    super(config)

    this._scopeManager = new ScopeManager()
    this._scope = new Scope()
    this._span = new Span(this)
  }

  trace (name, options, fn) {
    return fn(this._span, () => {})
  }

  wrap (name, options, fn) {
    return fn
  }

  scopeManager () {
    return this._scopeManager
  }

  scope () {
    return this._scope
  }

  currentSpan () {
    return null
  }

  getRumData () {
    return ''
  }

  setUrl () {
  }

  _startSpan (name, options) {
    return this._span
  }
}

module.exports = NoopTracer
