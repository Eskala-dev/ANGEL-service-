import express from 'express';
import Pagos from '../models/pagos.js';
import Factura from '../models/Factura.js';
import db from '../config/db.js';

const router = express.Router();

export const handleAddPago = async (nuevoPago, session) => {
  if (nuevoPago?.total > 0) {
    const pagoNuevo = new Pagos(nuevoPago);

    const pagoGuardado = await pagoNuevo.save({ session });

    return pagoGuardado.toObject();
  } else {
    return null;
  }
};

// Ruta para agregar un nuevo registro de pago
router.post('/add-pago', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { idOrden, date, metodoPago, total, idUser, isCounted, detail } = req.body;

    // 1. Buscar `listPago` y `totalNeto` de la factura correspondiente al `idOrden`
    const factura = await Factura.findById(idOrden, 'listPago totalNeto').lean();

    if (!factura) {
      throw new Error('Factura no encontrada');
    }

    // 2. Obtener todos los pagos referenciados en `listPago`
    const pagosExistentes = await Pagos.find({ _id: { $in: factura.listPago } }, 'total').lean();

    // 3. Calcular la suma total de los pagos existentes
    const totalPagosActuales = pagosExistentes.reduce((sum, pago) => sum + (pago.total || 0), 0);

    // 4. Verificar si el total acumulado más el nuevo `total` supera `totalNeto`
    if (totalPagosActuales + total > factura.totalNeto) {
      throw new Error('El total acumulado de los pagos supera el total neto permitido.');
    }

    // 5. Crear y guardar el nuevo pago
    const nuevoPago = new Pagos({
      idOrden,
      date,
      metodoPago,
      total,
      idUser,
      isCounted,
      detail,
    });

    const pagoGuardado = await nuevoPago.save({ session });

    // 6. Actualizar la factura agregando el ID del nuevo pago a `listPago`
    await Factura.findByIdAndUpdate(idOrden, { $addToSet: { listPago: pagoGuardado._id } }, { session });

    // 7. Confirmar la transacción
    await session.commitTransaction();

    // 8. Responder con el nuevo pago
    res.json(pagoGuardado.toObject());
  } catch (error) {
    console.error('Error al agregar el pago:', error);
    await session.abortTransaction();
    res.status(500).json({ mensaje: 'Error al agregar el pago', error: error.message });
  } finally {
    session.endSession();
  }
});

// Ruta para editar un pago por su ID
router.put('/edit-pago/:idPago', async (req, res) => {
  try {
    // Obtener el ID del pago a editar desde los parámetros de la URL
    const { idPago } = req.params;

    // Obtener los nuevos datos del cuerpo de la solicitud
    const { date, metodoPago, total, idUser, detail } = req.body;

    // Buscar el pago por su ID y actualizarlo con los nuevos datos
    const pagoActualizado = await Pagos.findByIdAndUpdate(
      idPago,
      {
        date,
        metodoPago,
        total,
        idUser,
        detail,
      },
      { new: true } // Devuelve el pago actualizado después de la edición
    );

    // Verificar si se encontró y actualizó el pago
    if (!pagoActualizado) {
      return res.status(404).json({ mensaje: 'Pago no encontrado' });
    }

    // Enviar la respuesta al cliente con el pago actualizado
    res.json(pagoActualizado.toObject());
  } catch (error) {
    console.error('Error al editar el pago:', error);
    res.status(500).json({ mensaje: 'Error al editar el pago', error: error.message });
  }
});

// Ruta para eliminar un pago por su ID
router.delete('/delete-pago/:idPago', async (req, res) => {
  try {
    // Obtener el ID del pago a eliminar desde los parámetros de la URL
    const { idPago } = req.params;

    // Buscar el pago por su ID y eliminarlo
    const pagoEliminado = await Pagos.findByIdAndDelete(idPago);

    // Verificar si se encontró y eliminó el pago
    if (!pagoEliminado) {
      return res.status(404).json({ mensaje: 'Pago no encontrado' });
    }

    // Obtener el ID de la factura asociada al pago eliminado
    const facturaId = pagoEliminado.idOrden;

    // Actualizar la factura asociada eliminando el ID del pago de su lista de pagos
    await Factura.findByIdAndUpdate(facturaId, {
      $pull: { listPago: pagoEliminado._id },
    });

    res.json({
      _id: pagoEliminado._id,
      idOrden: pagoEliminado.idOrden,
    });
  } catch (error) {
    console.error('Error al eliminar el pago:', error);
    res.status(500).json({ mensaje: 'Error al eliminar el pago', error: error.message });
  }
});

export default router;
