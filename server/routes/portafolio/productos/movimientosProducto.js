import express from 'express';
import MovimientoProducto from '../../../models/portafolio/productos/movimientosProducto.js';
import Producto from '../../../models/portafolio/productos/productos.js';
import db from '../../../config/db.js';
import { emitToClients } from '../../../socket/socketServer.js';

const router = express.Router();

export const handleAddMovimientoProducto = async (data, session) => {
  const { idProducto, accion, cantidad, tipo, info } = data;

  const newMovimiento = new MovimientoProducto({
    idProducto,
    accion,
    cantidad,
    tipo,
    info,
  });

  await newMovimiento.save({ session });
};

router.post('/add-movimiento-producto', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { idProducto, accion, cantidad, tipo, info } = req.body;

    // Agregar el nuevo movimiento
    await handleAddMovimientoProducto({ idProducto, accion, cantidad, tipo, info }, session);

    // Actualizar el stock principal del producto
    const producto = await Producto.findById(idProducto).session(session);
    if (!producto) {
      throw new Error('Producto no encontrado');
    }

    if (tipo === 'positivo') {
      producto.stockPrincipal += cantidad;
    } else if (tipo === 'negativo') {
      producto.stockPrincipal -= cantidad;
      if (producto.stockPrincipal < 0) {
        producto.stockPrincipal = 0; // Asegurarse de que el stock no sea negativo
      }
    }

    await producto.save({ session });

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'service:updatedProductos',
      [{ _id: producto._id.toString(), stockPrincipal: producto.stockPrincipal }],
      socketId
    );

    res.json({
      _id: producto._id.toString(),
      stockPrincipal: producto.stockPrincipal,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error('Error al agregar movimiento:', error);
    res.status(500).json({ mensaje: 'Error al agregar movimiento' });
  } finally {
    session.endSession();
  }
});

export default router;
