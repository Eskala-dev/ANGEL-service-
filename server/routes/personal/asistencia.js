import express from 'express';
import Asistencia from '../../models/personal/asistencia.js';
import moment from 'moment';
import { updateDateNacimiento } from './personal.js';
import { emitToClients } from '../../socket/socketServer.js';

const router = express.Router();

router.get('/get-list-asistencia/:fecha/:idPersonal', async (req, res) => {
  try {
    const fecha = req.params.fecha;
    const idPersonal = req.params.idPersonal;

    // Parsear la fecha usando Moment.js
    const momentFecha = moment(fecha, 'YYYY-MM-DD');
    // Obtener el año de la fecha proporcionada
    const startOfMonth = momentFecha.startOf('month').format('YYYY-MM-DD');
    const endOfMonth = momentFecha.endOf('month').format('YYYY-MM-DD');

    // Obtener la lista de asistencias del personal en el mes dado
    const listAsistencia = await Asistencia.find({
      idPersonal: idPersonal,
      fecha: { $gte: startOfMonth, $lte: endOfMonth },
    })
      .select('fecha tipoRegistro ingreso salida observacion time')
      .lean();

    res.json(listAsistencia);
  } catch (error) {
    console.error('Error al obtener las asistencias:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/registrar-asistencia', async (req, res) => {
  try {
    // Obtener los datos del cuerpo de la solicitud
    const { idPersonal, fecha, tipoRegistro, ingreso, salida, observacion } = req.body;

    console.log(req.body);

    // Crear una instancia del modelo Asistencia con los datos recibidos
    const nuevaAsistencia = new Asistencia({
      idPersonal,
      fecha,
      tipoRegistro,
      ingreso,
      salida,
      observacion,
    });

    // Guardar la nueva asistencia en la base de datos
    const asistenciaGuardada = await nuevaAsistencia.save();

    if (asistenciaGuardada.tipoRegistro === 'cumpleaños') {
      const infoPersonalUpdated = await updateDateNacimiento(
        asistenciaGuardada.idPersonal,
        asistenciaGuardada.fecha,
        'add'
      );

      emitToClients('server:cPersonal', {
        tipo: 'updated',
        info: infoPersonalUpdated,
      });
    }

    res.status(201).json({ newInfoDay: asistenciaGuardada });
  } catch (error) {
    // Manejar errores
    res.status(500).json({ message: error.message });
  }
});

router.put('/actualizar-asistencia/:id', async (req, res) => {
  try {
    // Obtener el ID de la asistencia de los parámetros de la solicitud
    const idAsistencia = req.params.id;

    // Obtener los datos actualizados del cuerpo de la solicitud
    const { fecha, tipoRegistro, ingreso, salida, observacion } = req.body;

    // Buscar la asistencia por su ID antes de actualizar
    const asistenciaAntesDeActualizar = await Asistencia.findById(idAsistencia);

    // Verificar si la asistencia existe
    if (!asistenciaAntesDeActualizar) {
      return res.status(404).json({ message: 'Asistencia no encontrada' });
    }

    // Actualizar la asistencia y devolver el nuevo documento actualizado
    const asistenciaActualizada = await Asistencia.findByIdAndUpdate(
      idAsistencia,
      {
        fecha,
        tipoRegistro,
        ingreso,
        salida,
        observacion,
      },
      { new: true } // Para devolver la asistencia actualizada después de la actualización
    );

    // Verificar si la asistencia fue actualizada correctamente
    if (!asistenciaActualizada) {
      return res.status(404).json({ message: 'Asistencia no encontrada después de intentar actualizar' });
    }

    // Verificar si el tipo de registro es 'cumpleaños' y proceder con la actualización del cumpleaños en Personal
    if (
      asistenciaAntesDeActualizar.tipoRegistro === 'cumpleaños' ||
      asistenciaActualizada.tipoRegistro === 'cumpleaños'
    ) {
      // Verificar que idPersonal esté definido y válido
      if (!asistenciaActualizada.idPersonal) {
        return res.status(400).json({ message: 'ID de personal no válido' });
      }

      const infoPersonalUpdated = await updateDateNacimiento(
        asistenciaActualizada.idPersonal,
        asistenciaActualizada.fecha,
        asistenciaActualizada.tipoRegistro === 'cumpleaños' ? 'add' : 'delete'
      );

      // Emitir actualización a los clientes conectados si todo está correcto
      emitToClients('server:cPersonal', {
        tipo: 'updated',
        info: infoPersonalUpdated,
      });
    }

    // Responder con la asistencia actualizada
    res.json({ newInfoDay: asistenciaActualizada });
  } catch (error) {
    // Log detallado del error en el servidor
    console.error('Error en actualizar asistencia:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
