import { Server } from 'socket.io';

export const connectedClients = new Map();
let io;

const socketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  io.on('connection', (socket) => {
    console.log('Nuevo cliente conectado');
    console.log(`Un cliente se ha conectado : ${socket.id}`);
    connectedClients.set(socket.id, socket);

    socket.on('disconnect', () => {
      console.log('Cliente desconectado');
      console.log(`Un cliente se ha desconectado : ${socket.id}`);
      connectedClients.delete(socket.id);
    });

    // Maneja eventos cuando el cliente envía un mensaje
    socket.on('client:changeOrder', (info) => {
      socket.broadcast.emit('server:changeOrder', info);
    });

    socket.on('client:updateCodigo', (info) => {
      io.emit('server:updateCodigo', info);
    });

    // UPDATE INFO EN ORDEN DE SERVICIO
    socket.on('client:updateOrder', (info) => {
      const { orderUpdated } = info;
      socket.broadcast.emit('server:orderUpdated', orderUpdated);
    });

    socket.on('client:updateOrder(FINISH_RESERVA)', (info) => {
      socket.broadcast.emit('server:updateOrder(FINISH_RESERVA)', info);
    });

    socket.on('client:updateOrder(ENTREGAR)', (info) => {
      socket.broadcast.emit('server:updateOrder(ENTREGAR)', info);
    });

    socket.on('client:updateOrder(CANCELAR_ENTREGA)', (info) => {
      socket.broadcast.emit('server:updateOrder(CANCELAR_ENTREGA)', info);
    });

    socket.on('client:updateOrder(ANULACION)', (info) => {
      socket.broadcast.emit('server:updateOrder(ANULACION)', info);
    });

    socket.on('client:updateOrder(NOTA)', (info) => {
      socket.broadcast.emit('server:updateOrder(NOTA)', info);
    });
    // ACCIONES EN REPORTE DE ORDEN (PENDIENTES Y ALMACENADOS):
    socket.on('client:updateOrder(LOCATION)', (info) => {
      socket.broadcast.emit('server:updateOrder(LOCATION)', info);
    });
    // REMOVER CUANDO SE ESTA ANULANDO O ENTREGANDO - DE REPORTE DE PENDIENTES Y ALMACEN
    socket.on('client:onRemoveOrderReporteAE', (info) => {
      socket.broadcast.emit('server:onRemoveOrderReporteAE', info);
    });
    // REMOVER CUANDO SE ESTA ALMACENANDO - DE REPORTE DE PENDIENTES
    socket.on('client:onRemoveOrderReportP', (info) => {
      socket.broadcast.emit('server:onRemoveOrderReportP', info);
    });
    // REMOVER CUANDO SE ESTA DONANDO - DE REPORTE DE ALMACENADO
    socket.on('client:onRemoveOrderReporteD', (info) => {
      socket.broadcast.emit('server:onRemoveOrderReporteD', info);
    });
    socket.on('client:onAddOrderAlmacen', (info) => {
      socket.broadcast.emit('server:onAddOrderAlmacen', info);
    });
    // ---------------------------------------- //
    socket.on('client:updateListOrder', (info) => {
      socket.broadcast.emit('server:updateListOrder', info);
      socket.broadcast.emit('server:updateListOrder:child', info);
    });

    socket.on('client:cancel-delivery', (info) => {
      socket.broadcast.emit('server:cancel-delivery', info);
    });

    socket.on('client:onLogin', (info) => {
      socket.broadcast.emit('server:onLogin', info);
    });

    socket.on('client:onNewUser', (info) => {
      socket.broadcast.emit('server:onNewUser', info);
    });

    socket.on('client:onChangeUser', (info) => {
      socket.broadcast.emit('server:onChangeUser', info);
    });

    socket.on('client:onUpdateUser', (info) => {
      socket.broadcast.emit('server:onUpdateUser', info);
    });

    socket.on('client:onDeleteUser', (info) => {
      socket.broadcast.emit('server:onDeleteUser', info);
    });

    // PARA INFORMAR AL CLIENTE, QUE SU CUENTA HA SIDO ELIMINADA
    // Y  LO SAQUE DEL SISTEMA
    socket.on('client:onDeleteAccount', (info) => {
      socket.broadcast.emit('server:onDeleteAccount', info);
    });

    socket.on('client:cPromotions', (info) => {
      socket.broadcast.emit('server:cPromotions', info);
    });

    socket.on('client:cPuntos', (info) => {
      socket.broadcast.emit('server:cPuntos', info);
    });

    socket.on('client:cNegocio', (info) => {
      socket.broadcast.emit('server:cNegocio', info);
    });

    socket.on('client:cGasto', (info) => {
      io.emit('server:cGasto', info);
    });

    socket.on('client:cImpuesto', (info) => {
      socket.broadcast.emit('server:cImpuesto', info);
    });

    socket.on('client:cPago', (info) => {
      socket.broadcast.emit('server:cPago', info);
    });

    socket.on('client:cClientes', (info) => {
      io.emit('server:cClientes', info);
    });

    socket.on('client:cService', (info) => {
      socket.broadcast.emit('server:cService', info);
    });

    socket.on('client:cCategoria', (info) => {
      socket.broadcast.emit('server:cCategoria', info);
    });
  });
};

export const emitToClients = (eventName, data, socketId) => {
  if (!io) {
    console.error('Socket.IO no está inicializado : No se pueden emitir eventos');
  } else {
    if (socketId && connectedClients.has(socketId)) {
      const requestingSocket = connectedClients.get(socketId);
      requestingSocket.broadcast.emit(eventName, data);
    } else {
      io.emit(eventName, data);
    }
  }
};

export default socketServer;
