import express from 'express';
import Negocio from '../models/negocio.js';
import { emitToClients } from '../socket/socketServer.js';

const router = express.Router();

export const verificarUsoProductos = async (req, res, next) => {
  try {
    const negocio = await Negocio.findOne().select('useProductos').lean();

    if (!negocio?.useProductos) {
      return res.json([]);
    }

    next();
  } catch (error) {
    console.error('Error al verificar uso de productos:', error);
    res.status(500).json({ mensaje: 'Error en la verificación de uso de productos' });
  }
};

export const verificarUsoInsumos = async (req, res, next) => {
  try {
    const negocio = await Negocio.findOne().select('useInsumos').lean();

    if (!negocio?.useInsumos) {
      return res.json([]);
    }

    next();
  } catch (error) {
    console.error('Error al verificar uso de insumos:', error);
    res.status(500).json({ mensaje: 'Error en la verificación de uso de insumos' });
  }
};

router.get('/get-info-negocio', async (req, res) => {
  try {
    // Intenta encontrar el único registro en la colección
    const negocio = await Negocio.findOne();

    return res.json(negocio);
  } catch (error) {
    // Manejo de errores
    console.error(error);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

router.put('/update-info-negocio', async (req, res) => {
  try {
    const negocio = await Negocio.findOneAndUpdate({}, req.body, { new: true }).lean();

    if (!negocio) {
      return res.status(404).json({ error: 'Informacion de negocio no encontrado' });
    }

    const { useProductos, useInsumos } = negocio;

    emitToClients('service:changeNegocio(USEPRODUCTO)', useProductos);
    emitToClients('service:changeNegocio(USEINSUMO)', useInsumos);

    return res.json(negocio);
  } catch (error) {
    console.error('Error al actualizar negocio:', error);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

export default router;
