import express from 'express';
import Producto from '../../../models/portafolio/productos/productos.js';
import MovimientoProducto from '../../../models/portafolio/productos/movimientosProducto.js';
import { mapArrayByKey } from '../../../utils/utilsFuncion.js';
import { handleAddMovimientoProducto } from './movimientosProducto.js';
import db from '../../../config/db.js';
import { emitToClients } from '../../../socket/socketServer.js';
import { verificarUsoProductos } from '../../negocio.js';

const router = express.Router();

router.post('/add-producto', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { infoProducto, infoMovimiento } = req.body;
    const { nombre, idCategoria, precioVenta, simboloMedida, stockPrincipal, notifyMinStock, estado } = infoProducto;
    const { accion, cantidad, tipo, info } = infoMovimiento;

    const newProducto = new Producto({
      nombre,
      idCategoria,
      precioVenta,
      simboloMedida,
      stockPrincipal,
      notifyMinStock,
      estado,
    });

    const productoGuardado = await newProducto.save({ session });

    await handleAddMovimientoProducto(
      {
        idProducto: productoGuardado._id,
        accion,
        cantidad,
        tipo,
        info,
      },
      session
    );

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'service:changeProducto',
      {
        tipoAction: 'added',
        data: productoGuardado,
      },
      socketId
    );

    res.json(productoGuardado);
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error('Error al Crear Producto:', error);
    res.status(500).json({ mensaje: 'Error al Crear Producto' });
  } finally {
    session.endSession();
  }
});

router.get('/get-productos', verificarUsoProductos, async (req, res) => {
  try {
    const productos = await Producto.find();

    res.json(productos);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ mensaje: 'Error al obtener productos' });
  }
});

router.put('/update-producto/:idProducto', async (req, res) => {
  const { idProducto } = req.params;
  const { nombre, idCategoria, precioVenta, simboloMedida, notifyMinStock, estado } = req.body;

  try {
    const updatedProducto = await Producto.findOneAndUpdate(
      { _id: idProducto },
      { $set: { nombre, idCategoria, precioVenta, simboloMedida, notifyMinStock, estado } },
      { new: true }
    );

    if (updatedProducto) {
      const socketId = req.headers['x-socket-id'];
      emitToClients(
        'service:changeProducto',
        {
          tipoAction: 'updated',
          data: updatedProducto.toObject(),
        },
        socketId
      );

      return res.json(updatedProducto);
    } else {
      return res.status(404).json({ mensaje: 'No se encontró el producto' });
    }
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ mensaje: 'Error al actualizar producto' });
  }
});

router.delete('/delete-producto/:idProducto', async (req, res) => {
  const { idProducto } = req.params;

  try {
    const productoEliminado = await Producto.findByIdAndRemove(idProducto);
    if (productoEliminado) {
      await MovimientoProducto.deleteMany({ idProducto });

      const socketId = req.headers['x-socket-id'];
      emitToClients(
        'service:changeProducto',
        {
          tipoAction: 'deleted',
          data: {
            _id: productoEliminado._id.toString(),
          },
        },
        socketId
      );
      return res.json({ mensaje: 'Producto y sus movimientos eliminados con éxito' });
    } else {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ mensaje: 'Error al eliminar producto' });
  }
});

export default router;
