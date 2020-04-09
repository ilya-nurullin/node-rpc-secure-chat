const {randomString} = require("./helpers");

class RPCMethods {
  static login(address, port) {
    return {
      method: "login",
      params: [address, port],
      id: randomString(),
    };
  }

  static updateClients(clients) {
    return {
      method: "updateClients",
      params: [clients],
      id: randomString(),
    }
  }

  static message(from, message, time) {
    return {
      method: "message",
      params: [from, message, time],
      id: randomString(),
    }
  }

  static handshakeStart(publicKey, myAddress) {
    return {
      method: "handshakeStart",
      params: [publicKey, myAddress],
      id: randomString(),
    }
  }

  static handshakeFinish(publicKey) {
    return {
      method: "handshakeFinish",
      params: [publicKey],
      id: randomString(),
    }
  }
}

module.exports = RPCMethods;