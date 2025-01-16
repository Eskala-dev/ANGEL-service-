import express from 'express';
import RolesPersonal from '../../models/personal/rolPersonal.js';
import Personal from '../../models/personal/personal.js';
import { emitToClients } from '../../socket/socketServer.js';

const router = express.Router();

router.get('/get-roles-personal', async (req, res) => {
  try {
    const listRolesPersonal = await RolesPersonal.find();
    res.status(200).json(listRolesPersonal);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/add-rol-personal', (req, res) => {
  const { nombre } = req.body;

  const newRolPersonal = new RolesPersonal({
    nombre,
  });

  newRolPersonal
    .save()
    .then(async (rolPersonalSaved) => {
      const rolPersonalS = rolPersonalSaved.toObject();

      const socketId = req.headers['x-socket-id'];
      emitToClients(
        'server:cRolPersonal',
        {
          tipo: 'added',
          info: rolPersonalS,
        },
        socketId
      );

      res.json(rolPersonalS);
    })
    .catch((error) => {
      console.error('Error al Guardar Rol Personal:', error);
      res.status(500).json({ mensaje: 'Error al Guardar Rol Personal' });
    });
});

router.put('/update-rol-personal/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;

  try {
    const rolPersonalActualizado = await RolesPersonal.findByIdAndUpdate(id, { nombre }, { new: true }).lean();
    if (!rolPersonalActualizado) {
      throw new Error('No se encontró el rol personal para actualizar');
    }

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'server:cRolPersonal',
      {
        tipo: 'updated',
        info: rolPersonalActualizado,
      },
      socketId
    );

    res.json(rolPersonalActualizado);
  } catch (error) {
    console.error('Error al actualizar rol personal:', error);
    res.status(500).json({ mensaje: 'Error al actualizar el rol personal' });
  }
});

router.delete('/delete-rol-personal/:id', async (req, res) => {
  const { id } = req.params;

  console.log(id);
  try {
    // Verificar si algún personal está usando este idRolPersonal
    const personalConRol = await Personal.findOne({ idRolPersonal: id });

    if (personalConRol) {
      // Si existe personal con este rol, no se puede eliminar
      return res.status(400).json({
        mensaje: 'No se puede eliminar el rol personal, ya que está siendo utilizado por un miembro del personal.',
      });
    }

    // Si no hay personal utilizando el rol, proceder con la eliminación
    const rolPersonalEliminado = await RolesPersonal.findByIdAndDelete(id).lean();

    if (!rolPersonalEliminado) {
      return res.status(404).json({
        mensaje: 'No se encontró el rol personal para eliminar',
      });
    }

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'server:cRolPersonal',
      {
        tipo: 'deleted',
        info: rolPersonalEliminado,
      },
      socketId
    );

    res.json(rolPersonalEliminado);
  } catch (error) {
    console.error('Error al eliminar rol personal:', error);
    res.status(500).json({ mensaje: 'Error al eliminar el rol personal' });
  }
});

export default router;
