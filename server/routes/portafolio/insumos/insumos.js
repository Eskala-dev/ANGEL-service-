import express from 'express';
import Insumos from '../../../models/portafolio/insumos/insumos.js';
import MovimientoInsumo from '../../../models/portafolio/insumos/movimientosInsumo.js';
import { mapArrayByKey } from '../../../utils/utilsFuncion.js';
import db from '../../../config/db.js';
import { emitToClients } from '../../../socket/socketServer.js';
import { verificarUsoInsumos } from '../../negocio.js';
import { handleAddMovimientoInsumo } from './movimientosInsumo.js';

const router = express.Router();

// Ruta para agregar insumos
router.post('/add-insumo', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { infoInsumo, infoMovimiento } = req.body;
    const { nombre, idCategoria, simboloMedida, stock, notifyMinStock, estado } = infoInsumo;
    const { accion, cantidad, tipo, detalle, infoRegistro } = infoMovimiento;

    const newInsumo = new Insumos({
      nombre,
      idCategoria,
      simboloMedida,
      stock,
      notifyMinStock,
      estado,
    });

    const insumoGuardado = await newInsumo.save({ session });

    await handleAddMovimientoInsumo(
      {
        idInsumo: insumoGuardado._id,
        accion,
        detalle,
        cantidad,
        tipo,
        infoRegistro,
      },
      session
    );

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'service:changeInsumo',
      {
        tipoAction: 'added',
        data: insumoGuardado,
      },
      socketId
    );

    res.json(insumoGuardado);
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error('Error al Crear Insumo:', error);
    res.status(500).json({ mensaje: 'Error al Crear Insumo' });
  } finally {
    session.endSession();
  }
});

// Ruta para obtener insumos
router.get('/get-insumos', verificarUsoInsumos, async (req, res) => {
  try {
    const insumos = await Insumos.find();

    res.json(insumos);
  } catch (error) {
    console.error('Error al obtener insumos:', error);
    res.status(500).json({ mensaje: 'Error al obtener insumos' });
  }
});

// Ruta para actualizar insumos
router.put('/update-insumo/:idInsumo', async (req, res) => {
  const { idInsumo } = req.params;
  const { nombre, idCategoria, simboloMedida, notifyMinStock, estado } = req.body;

  try {
    const updatedInsumo = await Insumos.findOneAndUpdate(
      { _id: idInsumo },
      { $set: { nombre, idCategoria, simboloMedida, notifyMinStock, estado } },
      { new: true }
    );

    if (updatedInsumo) {
      const socketId = req.headers['x-socket-id'];
      emitToClients(
        'service:changeInsumo',
        {
          tipoAction: 'updated',
          data: updatedInsumo.toObject(),
        },
        socketId
      );

      return res.json(updatedInsumo);
    } else {
      return res.status(404).json({ mensaje: 'No se encontró el insumo' });
    }
  } catch (error) {
    console.error('Error al actualizar insumo:', error);
    res.status(500).json({ mensaje: 'Error al actualizar insumo' });
  }
});

// Ruta para eliminar insumos
router.delete('/delete-insumo/:idInsumo', async (req, res) => {
  const { idInsumo } = req.params;

  try {
    const insumoEliminado = await Insumos.findByIdAndRemove(idInsumo);
    if (insumoEliminado) {
      await MovimientoInsumo.deleteMany({ idInsumo });

      const socketId = req.headers['x-socket-id'];
      emitToClients(
        'service:changeInsumo',
        {
          tipoAction: 'deleted',
          data: {
            _id: insumoEliminado._id.toString(),
          },
        },
        socketId
      );
      return res.json({ mensaje: 'Insumo y sus movimientos eliminados con éxito' });
    } else {
      return res.status(404).json({ mensaje: 'Insumo no encontrado' });
    }
  } catch (error) {
    console.error('Error al eliminar insumo:', error);
    res.status(500).json({ mensaje: 'Error al eliminar insumo' });
  }
});

export default router;
