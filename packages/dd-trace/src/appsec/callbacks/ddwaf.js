'use strict'

const log = require('../../log')
const Addresses = require('../addresses')
const Gateway = require('../../gateway/engine')
const Reporter = require('../reporter')

let warned = false

const validAddressSet = new Set(Object.values(Addresses))

const DEFAULT_MAX_BUDGET = 5e3 // µs

// TODO: put reusable code in a base class
class WAFCallback {
  static loadDDWAF (rules) {
    try {
      // require in `try/catch` because this can throw at require time
      const { DDWAF } = require('@datadog/native-appsec')

      return new DDWAF(rules)
    } catch (err) {
      if (!warned) {
        log.warn('AppSec could not load native package. In-app WAF features will not be available.')
        warned = true
      }

      throw err
    }
  }

  constructor (rules) {
    this.ddwaf = WAFCallback.loadDDWAF(rules)
    this.wafContextCache = new WeakMap()
    this.ruleCache = new Map()

    // closures are faster than binds
    const self = this
    const method = (params, store) => {
      self.action(params, store)
    }

    // might be its own class with more info later
    const callback = { method }

    const subscriptionGroups = new Set()

    for (const rule of rules.rules) {
      this.ruleCache.set(rule.id, rule)

      for (const condition of rule.conditions) {
        let addresses = condition.parameters.inputs.map((input) => input.address.split(':', 2)[0])

        if (!addresses.every((address) => validAddressSet.has(address))) {
          log.warn(`Skipping invalid rule ${rule.id}`)
          break
        }

        addresses = Array.from(new Set(addresses))

        const hash = addresses.sort().join(',')

        if (subscriptionGroups.has(hash)) continue
        subscriptionGroups.add(hash)

        Gateway.manager.addSubscription({ addresses, callback })
      }
    }
  }

  action (params, store) {
    let wafContext

    if (store) {
      const key = store.get('context')

      if (key) {
        if (this.wafContextCache.has(key)) {
          wafContext = this.wafContextCache.get(key)
        } else {
          wafContext = this.ddwaf.createContext()
          this.wafContextCache.set(key, wafContext)
        }
      }
    }

    if (!wafContext) {
      wafContext = this.ddwaf.createContext()
    }

    try {
      const result = wafContext.run(params, DEFAULT_MAX_BUDGET)

      return this.applyResult(result)
    } catch (err) {
      log.warn('Error while running the AppSec WAF')
    }
  }

  applyResult (result) {
    if (result.action) {
      const data = JSON.parse(result.data)

      for (let i = 0; i < data.length; ++i) {
        const point = data[i]
        const match = point.filter[0]

        const rule = this.ruleCache.get(point.rule)

        Reporter.reportAttack({
          eventType: 'appsec.threat.attack',
          blocked: false,
          ruleId: point.rule,
          ruleName: rule.name,
          ruleTags: rule.tags,
          matchOperator: match.operator,
          matchOperatorValue: match.operator_value,
          matchParameters: [{
            address: match.binding_accessor,
            key_path: match.key_path,
            value: match.resolved_value
          }],
          matchHighlight: [
            match.match_status
          ]
        })
      }
    }

    // result.perfData
    // result.perfTotalRuntime
  }

  clear () {
    this.libAppSec.dispose()

    this.wafContextCache = new WeakMap()

    Gateway.manager.clear()
  }
}

module.exports = WAFCallback
