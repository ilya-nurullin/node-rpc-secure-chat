const net = require("net");
const AddressInfo = require("./AddressInfo");
const RPCMethods = require("./RPCMethods");

let serverInfo; // информация об адресе сервера
let connectedClients = []; // адреса подключенных клиентов
let openConnections = {}; // установленные соединения с клиентами

const server = net.createServer(connection => {
  let currentClientsServerConnection;

  connection.on('error', (err) => logout(currentClientsServerConnection));
  connection.on('close', (err) => logout(currentClientsServerConnection));

  connection.on('data', (data) => {
    let request = JSON.parse(data.toString());
    switch (request.method) {
      case "login": {
        currentClientsServerConnection = newLogIn(request.params[0], request.params[1]);
        broadcastClientsUpdated();
      } break;
    }
  });

});

server.listen(39874,socket => {
  serverInfo = new AddressInfo(server.address().address, server.address().port);

  console.info("Server started: "+serverInfo);
});

function newLogIn(address, port) {
  let connectionInfo = new AddressInfo(address, port);

  console.info("New connection: " + connectionInfo);

  connectedClients.push(connectionInfo);

  return connectionInfo;
}

function logout(addressInfo) {
  if (connectedClients.filter(v => v.address === addressInfo.address && v.port === addressInfo.port).length === 0)
    return;

  connectedClients = connectedClients.filter(v => !(v.address === addressInfo.address && v.port === addressInfo.port));
  console.log("Disconnected: "+addressInfo);
  broadcastClientsUpdated();
}

function getConnection(clientAddress) {
  let hash = clientAddress.address + '-' + clientAddress.port;
  if (!(hash in openConnections)) {
    let connect = net.connect(clientAddress.port, clientAddress.address);
    openConnections[hash] = connect;

    connect.on("error", err => logout(clientAddress));
  }
  return openConnections[hash];
}

function broadcastClientsUpdated() {
  for (let i = 0; i < connectedClients.length; i++) {
    let clientAddress = connectedClients[i];
    getConnection(clientAddress).write(JSON.stringify(RPCMethods.updateClients(connectedClients)));
  }
}

