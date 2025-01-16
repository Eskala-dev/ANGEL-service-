import express from 'express';
import Negocio from '../models/negocio.js';

const router = express.Router();

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
    // Intenta encontrar el único registro en la colección
    const negocio = await Negocio.findOne();

    if (!negocio) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    // Actualiza los campos del registro con los datos proporcionados en la solicitud
    Object.assign(negocio, req.body);

    // Guarda los cambios en la base de datos
    await negocio.save();
    return res.json(negocio);
  } catch (error) {
    // Manejo de errores
    console.error(error);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});

export default router;
