import express from 'express';
import MovimientoInsumo from '../../../models/portafolio/insumos/movimientosInsumo.js';
import Insumo from '../../../models/portafolio/insumos/insumos.js';
import db from '../../../config/db.js';
import { emitToClients } from '../../../socket/socketServer.js';

const router = express.Router();

export const handleAddMovimientoInsumo = async (data, session) => {
  const { idProducto, accion, cantidad, tipo, info } = data;

  const newMovimiento = new MovimientoInsumo({
    idInsumo,
    accion,
    detalle,
    cantidad,
    tipo,
    infoRegistro,
  });

  await newMovimiento.save({ session });
};

router.post('/add-movimiento-insumo', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { idInsumo, accion, cantidad, tipo, infoRegistro, detalle } = req.body;

    // Agregar el nuevo movimiento
    const newMovimiento = new MovimientoInsumo({
      idInsumo,
      accion,
      cantidad,
      tipo,
      infoRegistro,
      detalle,
    });

    const nuevoMovimiento = await newMovimiento.save({ session });

    // Actualizar el stock del insumo
    const insumo = await Insumo.findById(idInsumo).session(session);
    if (!insumo) {
      throw new Error('Insumo no encontrado');
    }

    if (tipo === 'positivo') {
      insumo.stock += cantidad;
    } else if (tipo === 'negativo') {
      insumo.stock -= cantidad;
      if (insumo.stock < 0) {
        insumo.stock = 0; // Asegurarse de que el stock no sea negativo
      }
    }

    await insumo.save({ session });

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'service:changeInsumo',
      {
        tipoAction: 'updated',
        data: {
          _id: insumo._id.toString(),
          stock: insumo.stock,
          movimientos: nuevoMovimiento,
        },
      },
      socketId
    );

    res.json({
      _id: insumo._id.toString(),
      nuevoMovimiento,
      stock: insumo.stock,
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
