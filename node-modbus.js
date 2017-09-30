import ModbusRTU from 'modbus-serial'
import _ from 'lodash'
import contra from 'contra'

const maxAttempts = 10
const maxConnAttempts = 5
const printDebug = false

const COIL_BITS_OFFSET = 999

class ModbusConnection {
  constructor () {
    this.ip = ''
    this.port = ''
    this.connected = false
    this.client = new ModbusRTU()
    this.reattempts = 0

    this.jobQueue = []
    this.executingJobs = false
  }

  enqueueJob (job) {
    modbusConnection.jobQueue.push(job)

    if (!modbusConnection.executingJobs) {
      modbusConnection.executingJobs = true
      modbusConnection.processQueue()
    }
  }

  attemptDisconnect () {
    if (modbusConnection.jobQueue.length === 0) {
      if (printDebug) {
        console.log('Disconnected!')
      }

      modbusConnection.client.close()

      modbusConnection.ip = ''
      modbusConnection.port = ''
      modbusConnection.connected = false
      modbusConnection.reattempts = 0

      modbusConnection.executingJobs = false
    } else {
      modbusConnection.processQueue()
    }
  }

  processQueue () {
    const currentQueue = modbusConnection.jobQueue.slice()

    contra.map.series(currentQueue, modbusConnection.executeJob, function (error, response) {
      // Remove the executed operations from currentQueue
      modbusConnection.jobQueue = _.drop(modbusConnection.jobQueue, currentQueue.length)

      // Call each of the operations's callback with their error or data
      currentQueue.forEach(function (operation, index) {
        if (error) {
          operation.callback(error)
        } else {
          operation.callback(null, response[index])
        }
      })

      setTimeout(() => {
        if (printDebug) {
          console.log('Waiting...')
        }
        modbusConnection.attemptDisconnect()
      }, 100)
    })
  }

  ensureConnected (options, callback) {
    const {
      ip,
      port
    } = options

    // If you're connected to one AG but want to read from
    // another, disconnect from your current one
    if (modbusConnection.ip !== ip) {
      modbusConnection.client.close()
      modbusConnection.connected = false
    }

    if (!modbusConnection.connected) {
      modbusConnection.client.connectTCP(ip, { port })
        .then(() => {
          if (printDebug) {
            console.log('Connected!')
          }

          modbusConnection.connected = true
          modbusConnection.reattempts = 0
          modbusConnection.ip = ip
          modbusConnection.port = port

          modbusConnection.client.setID(1)
          modbusConnection.client.setTimeout(5000)

          callback(null)
        })
        .catch((error) => {
          if (printDebug) {
            console.log('ensureConnected(): ', error)
          }

          // If this fails, re-attempt
          modbusConnection.connected = false

          if (modbusConnection.reattempts < maxConnAttempts) {
            // Set a timeout here. Connection gets refused sometimes when the
            // port is being hogged
            setTimeout(() => {
              modbusConnection.reattempts++

              modbusConnection.ensureConnected(options, (error) => {
                if (error) {
                  modbusConnection.reattempts = 0
                  callback(error)
                  return
                }

                modbusConnection.reattempts = 0
                callback(null)
              })
            }, 100)
          } else {
            callback(error)
          }
        })
    } else {
      // Already connected, just return
      callback(null)
    }
  }

  executeJob (options, callback) {
    const {
      ip,
      port,
      job
    } = options

    const {
      type,
      start,
      count,
      data
    } = job

    if (type === 'readRegisters') {
      modbusConnection.readRegisters({
        ip,
        port,
        start,
        count
      }, callback)
    } else if (type === 'readCoils') {
      modbusConnection.readModbusCoils({
        ip,
        port,
        start,
        count
      }, (error, readings) => {
        if (error) {
          callback(error)
          return
        }

        callback(null, readings)
      })
    } else if (type === 'writeRegisters') {
      modbusConnection.writeModbusRegisters({
        ip,
        port,
        start,
        data
      }, (error) => {
        if (error) {
          callback(error)
          return
        }

        callback(null)
      })
    } else if (type === 'writeCoils') {
      // We actually want to do single writes, break up the writes into
      // individual operations
      const toWrite = []
      for (var i = start; i < start + data.length; i++) {
        toWrite.push({
          ip,
          port,
          start: i,
          data: data[i - start]
        })
      }

      contra.map.series(toWrite, modbusConnection.writeModbusCoil, (error, response) => {
        if (error) {
          callback(error)
          return
        }

        callback(null)
      })
    } else {
      callback('unknown job type ' + type)
    }
  }

  readRegisters (options, callback) {
    const {
      ip,
      port,
      start,
      count
    } = options

    // Break up register reads into 50-register chunks. Modbus tends to get overloaded with anything larger
    // First put in as many 50 register chunks as you can
    const toRead = []
    for (let i = 0; i < parseInt(count / 50); i++) {
      toRead.push({
        ip,
        port,
        start: start + (i * 50),
        count: 50
      })
    }

    // If there's a ragged edge, add that in as well
    if (count % 50 !== 0) {
      toRead.push({
        ip,
        port,
        start: start + (parseInt(count / 50) * 50),
        count: count - (toRead.length * 50)
      })
    }

    contra.map.series(toRead, modbusConnection.readModbusRegisters, (error, readings) => {
      if (error) {
        callback(error)
        return
      }

      callback(null, _.flatten(readings))
    })
  }

  readModbusCoils (options, callback) {
    const {
      ip,
      port,
      start,
      count
    } = options

    modbusConnection.ensureConnected({ ip, port }, (error) => {
      if (error) {
        callback(error)
        return
      }

      // 'count' according to modbus means the number of bits you want to read
      // for us it means the number of registers you want to read
      const formattedCount = count * 8

      // https://github.com/yaacov/node-modbus-serial/wiki/Methods#readcoils-address-length
      modbusConnection.client.readCoils(start + COIL_BITS_OFFSET, formattedCount)
        .then((received) => {
          // Return every 8th reading
          const toReturn = []
          for (let i = 0; i < received.data.length; i += 8) {
            toReturn.push(received.data[i])
          }

          callback(null, toReturn)
        })
        .catch((error) => {
          if (printDebug) {
            console.log('readModbusCoils(): ', error)
          }

          if (modbusConnection.reattempts < maxAttempts) {
            modbusConnection.reattempts++

            modbusConnection.readModbusCoils(options, (error, readings) => {
              if (error) {
                modbusConnection.reattempts = 0
                callback(error)
                return
              }

              // Return every 8th reading
              const toReturn = []
              for (let i = 0; i < readings.length; i += 8) {
                toReturn.push(readings[i])
              }

              modbusConnection.reattempts = 0
              callback(null, toReturn)
            })
          } else {
            callback(error)
          }
        })
    })
  }

  readModbusRegisters (options, callback) {
    const {
      ip,
      port,
      start,
      count
    } = options

    modbusConnection.ensureConnected({ ip, port }, (error) => {
      if (error) {
        callback(error)
        return
      }

      modbusConnection.client.readHoldingRegisters(start - 1, count)
        .then((received) => {
          callback(null, received.data)
        })
        .catch((error) => {
          if (printDebug) {
            console.log('readModbusRegisters(): ', error, start, count)
          }

          if (modbusConnection.reattempts < maxAttempts) {
            modbusConnection.reattempts++

            modbusConnection.readModbusRegisters(options, (error, readings) => {
              if (error) {
                modbusConnection.reattempts = 0
                callback(error)
                return
              }

              modbusConnection.reattempts = 0
              callback(null, _.flatten(readings))
            })
          } else {
            callback(error)
          }
        })
    })
  }

  writeModbusRegisters (options, callback) {
    const {
      ip,
      port,
      start,
      data
    } = options

    modbusConnection.ensureConnected({ ip, port }, (error) => {
      if (error) {
        callback(error)
        return
      }

      modbusConnection.client.writeRegisters(start - 1, data)
        .then((response) => {
          callback(null)
        })
        .catch((error) => {
          if (printDebug) {
            console.log('writeModbusRegisters(): ', error)
          }

          if (modbusConnection.reattempts < maxAttempts) {
            modbusConnection.reattempts++

            modbusConnection.writeModbusRegisters(options, (error) => {
              if (error) {
                modbusConnection.reattempts = 0
                callback(error)
                return
              }

              modbusConnection.reattempts = 0
              callback(null)
            })
          } else {
            callback(error)
          }
        })
    })
  }

  writeModbusCoil (options, callback) {
    const {
      ip,
      port,
      start,
      data
    } = options

    modbusConnection.ensureConnected({ ip, port }, (error) => {
      if (error) {
        callback(error)
        return
      }

      modbusConnection.client.writeCoil(start + COIL_BITS_OFFSET, data)
        .then((response) => {
          callback(null)
        })
        .catch((error) => {
          if (printDebug) {
            console.log('writeModbusCoils(): ', error)
          }

          if (modbusConnection.reattempts < maxAttempts) {
            modbusConnection.reattempts++

            modbusConnection.writeModbusCoil(options, (error) => {
              if (error) {
                modbusConnection.reattempts = 0
                callback(error)
                return
              }

              modbusConnection.reattempts = 0
              callback(null)
            })
          } else {
            callback(error)
          }
        })
    })
  }

}

export const modbusConnection = new ModbusConnection()

// ====== Public ====== //
// These methods are our interface layer. They don't specifically rely on
// the ModbusRTU library
export function readRegisters (options, callback) {
  const {
    ip,
    port,
    start,
    count
  } = options

  modbusConnection.enqueueJob({
    ip,
    port,
    job: {
      type: 'readRegisters',
      start,
      count
    },
    callback
  })
}

export function readCoils (options, callback) {
  const {
    ip,
    port,
    start,
    count
  } = options

  modbusConnection.enqueueJob({
    ip,
    port,
    job: {
      type: 'readCoils',
      start,
      count
    },
    callback
  })
}

export function writeRegisters (options, callback) {
  const {
    ip,
    port,
    start,
    data
  } = options

  modbusConnection.enqueueJob({
    ip,
    port,
    job: {
      type: 'writeRegisters',
      start,
      data
    },
    callback
  })
}

export function writeCoils (options, callback) {
  const {
    ip,
    port,
    start,
    data
  } = options

  modbusConnection.enqueueJob({
    ip,
    port,
    job: {
      type: 'writeCoils',
      start,
      data
    },
    callback
  })
}
