import express from 'express';
import Personal from '../../models/personal/personal.js';
import Asistencia from '../../models/personal/asistencia.js';
import moment from 'moment';
import db from '../../config/db.js';

import { emitToClients } from '../../socket/socketServer.js';

const router = express.Router();

router.get('/get-list-personals', async (req, res) => {
  try {
    const listPersonal = await Personal.find();
    res.status(200).json(listPersonal);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/registrar-personal', async (req, res) => {
  try {
    const { name, tipo, idRolPersonal } = req.body;
    let info = null;
    if (tipo === 'interno') {
      const { horaIngreso, horaSalida, pagoByHour, dateNacimiento, pagoMensual } = req.body;
      info = {
        horaIngreso,
        horaSalida,
        pagoByHour,
        dateNacimiento,
        birthDayUsed: [],
        pagoMensual,
      };
    }

    const newPersonal = new Personal({
      name,
      tipo,
      idRolPersonal,
      info,
    });

    const personalSaved = await newPersonal.save();

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'server:cPersonal',
      {
        tipo: 'added',
        info: personalSaved,
      },
      socketId
    );

    res.status(201).json(personalSaved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/actualizar-personal/:id', async (req, res) => {
  try {
    const idPersonal = req.params.id;

    const { name, tipo } = req.body;

    let info = null;
    if (tipo === 'interno') {
      const { horaIngreso, horaSalida, pagoByHour, dateNacimiento, pagoMensual } = req.body;

      info = {
        horaIngreso,
        horaSalida,
        pagoByHour,
        dateNacimiento,
        birthDayUsed: [],
        pagoMensual,
      };
    } else if (tipo === 'externo') {
      info = null;
    }

    const personalActualizado = await Personal.findByIdAndUpdate(
      idPersonal,
      {
        name,
        tipo,
        info,
      },
      { new: true }
    );

    if (!personalActualizado) {
      return res.status(404).json({ message: 'Personal no encontrado' });
    }

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'server:cPersonal',
      {
        tipo: 'updated',
        info: personalActualizado,
      },
      socketId
    );

    res.json(personalActualizado);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/eliminar-personal/:id', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const idPersonal = req.params.id;

    // Eliminar el personal
    const personalEliminado = await Personal.findByIdAndDelete(idPersonal).session(session);

    if (personalEliminado.tipo === 'interno') {
      await Asistencia.deleteMany({ idPersonal }).session(session);
    }

    if (!personalEliminado) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Personal no encontrado' });
    }

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];
    emitToClients(
      'server:cPersonal',
      {
        tipo: 'deleted',
        info: personalEliminado,
      },
      socketId
    );

    res.json(personalEliminado);
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

export const updateDateNacimiento = async (idPersonal, newCumpleañoUsed, tipo) => {
  try {
    const newYear = moment(newCumpleañoUsed).format('YYYY');

    let updateQuery;

    if (tipo === 'add') {
      // Agregar nuevo año solo si no existe
      updateQuery = {
        $addToSet: {
          // Usa $addToSet para evitar duplicados
          'info.birthDayUsed': newCumpleañoUsed,
        },
      };
    } else if (tipo === 'delete') {
      // Eliminar el año
      updateQuery = {
        $pull: {
          // Usa $pull para eliminar el año
          'info.birthDayUsed': newCumpleañoUsed,
        },
      };
    } else {
      throw new Error("Tipo no válido. Debe ser 'add' o 'delete'.");
    }

    const personalActualizado = await Personal.findByIdAndUpdate(idPersonal, updateQuery, {
      new: true, // Devuelve el documento actualizado
      runValidators: true, // Ejecuta validaciones en la actualización
    });

    if (!personalActualizado) {
      throw new Error('Personal no encontrado');
    }

    return personalActualizado; // Devolver el personal actualizado
  } catch (error) {
    console.error('Error en updateDateNacimiento:', error);
    throw new Error(error.message);
  }
};

export default router;
