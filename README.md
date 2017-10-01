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
