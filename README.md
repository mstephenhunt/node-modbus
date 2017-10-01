# Node-Modbus Job Queue API
This is a Node-Modbus Job Queue API based on the [ModbusRTU npm package](https://github.com/thekip/node-modbus-rtu), communicating to `Modbus` controllers via `TCP`.

## Usage:
There are four interface functions, `readRegisters()`, `readCoils()`, `writeRegisters()` and `writeCoils()`. Each one of them requires an `ip` and `port` of the `Modbus` controller you want to connect to and a `start` integer, a one-indexed value indicating which `register` or `coil` to start your action from.

When reading, you also need to provide a `count` of the number of `registers` or `coils` you're looking to read from. When writing, you need to provide `data`: either an integer array for `registers` or a `bool` array for `coils`.

To use these interfaces, it's a simple as:
```js
import {
  readRegisters
} from './node-modbus'

readRegisters({
  ip: '192.168.1.2',
  port: 502,
  start: 100,
  count: 50
}, function (error, readings) {
  // ...  
})
```

## Job Queue:
The job queue is an automatic feature of this API that allows you to asynchronously enqueue "modbus jobs" -- but it also has the benefit of:
   1) Staying connected to the controller while there are jobs in the queue
   2) Disconnecting from the controller when all jobs are complete

This second feature is super helpful if you have multiple clients connecting to this controller and don't want them to hog ports.

## Other Features:
# Register Read Breakup:
The controllers I used would become unresponsive if you attempted to read too large of register chunks in one request. Due to this, in `ModbusConnection.readRegisters()`, register reads are broken up into 50-register chunk requests. These are then executed in series, then flattened into a single response to the caller. 

It effectively protects from the modbus controller becoming overloaded while still giving the abstraction that you can read from larger register chunks in one go.

# Abstracting Single Bool-Coil
When reading `coils`, the controller used for this implementation only cared about the first bit. To account for this, only the first bit read from a `coil` is returned.

This means when you provide a `count` to read `coils`, you're getting the first bit of each `coil` from `start` to `count`.