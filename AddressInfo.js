class AddressInfo {
  address;
  port;

  constructor(address, port) {
    this.address = address;
    this.port = port;
  }

  toString() {
    return `Address = ${this.address}, Port = ${this.port}`;
  }
}

module.exports = AddressInfo;