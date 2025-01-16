import express from 'express';
import clientes from '../models/clientes.js';
import Factura from '../models/Factura.js';
import moment from 'moment';
import { currentDate } from '../utils/utilsFuncion.js';
import db from '../config/db.js';
import { checkPuntosState } from './puntos.js';
import { emitToClients } from '../socket/socketServer.js';

const router = express.Router();

router.post('/add-cliente', async (req, res) => {
  const { dni, nombre, direccion, phone } = req.body;

  try {
    // Crear un nuevo cliente
    const nuevoCliente = new clientes({
      dni,
      nombre,
      direccion,
      phone,
      infoScore: [],
      scoreTotal: 0,
    });

    // Guardar el nuevo cliente en la base de datos
    await nuevoCliente.save();

    emitToClients('server:cClientes', {
      tipoAction: 'add',
      data: nuevoCliente,
    });

    // Enviar una respuesta exitosa
    res.status(201).json(nuevoCliente);
  } catch (error) {
    // Enviar un mensaje de error si ocurre algún problema durante la creación del cliente
    console.error('Error al agregar cliente:', error);
    res.status(500).json({ mensaje: 'Error al agregar cliente' });
  }
});

router.get('/get-info-clientes', async (req, res) => {
  try {
    const allClientes = await clientes.find().select('dni nombre phone direccion scoreTotal');
    res.json(allClientes);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener los clientes', error });
  }
});

router.get('/get-informe-visitas-clientes', async (req, res) => {
  const { startDate, endDate, maxClientes } = req.query;

  if (!startDate || !endDate || !maxClientes) {
    return res.status(400).json({ mensaje: 'startDate, endDate y maxClientes son requeridos' });
  }

  try {
    // Convertir las fechas a objetos moment
    const start = moment(startDate, 'YYYY-MM-DD').startOf('day').toDate();
    const end = moment(endDate, 'YYYY-MM-DD').endOf('day').toDate();

    // Obtener todos los clientes y sus IDs
    const allClientes = await clientes.find().select('_id dni nombre direccion phone scoreTotal').lean();
    const clienteIds = allClientes.map((cliente) => cliente._id.toString());

    // Consultar las facturas en el rango de fechas proporcionado
    const facturas = await Factura.find({
      'infoRecepcion.fecha': { $gte: start, $lte: end },
      estadoPrenda: 'entregado',
      idCliente: { $in: clienteIds },
    }).lean();

    // Contar el número de facturas por cliente
    const facturasPorCliente = facturas.reduce((acc, factura) => {
      acc[factura.idCliente] = (acc[factura.idCliente] || 0) + 1;
      return acc;
    }, {});

    // Convertir el objeto en un array y ordenar por el número de facturas
    const resultados = Object.entries(facturasPorCliente)
      .map(([idCliente, numeroFacturas]) => {
        const cliente = allClientes.find((cliente) => cliente._id.toString() === idCliente);
        return {
          idCliente,
          numeroFacturas,
          dni: cliente.dni,
          nombre: cliente.nombre,
          direccion: cliente.direccion,
          phone: cliente.phone,
          scoreTotal: cliente.scoreTotal,
        };
      })
      .sort((a, b) => b.numeroFacturas - a.numeroFacturas)
      .slice(0, parseInt(maxClientes, 10));

    res.json(resultados);
  } catch (error) {
    console.error('Error al obtener facturas por cliente:', error);
    res.status(500).json({ mensaje: 'Error al obtener facturas por cliente' });
  }
});

router.put('/edit-cliente/:id', async (req, res) => {
  const clientId = req.params.id;

  try {
    // Find the client by ID and update with the provided fields
    const clienteActualizado = await clientes.findByIdAndUpdate(
      clientId,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!clienteActualizado) {
      return res.status(404).json({ mensaje: 'Cliente no encontrado' });
    }

    emitToClients('server:cClientes', {
      tipoAction: 'update',
      data: clienteActualizado,
    });

    emitToClients('server:updateCliente', clienteActualizado);

    // Send the updated client along with a success message
    res.json(clienteActualizado);
  } catch (error) {
    console.error('Error al editar el cliente:', error);
    res.status(500).json({ mensaje: 'Error al editar el cliente' });
  }
});

router.delete('/delete-cliente/:id', async (req, res) => {
  const clientId = req.params.id;

  try {
    // Eliminar el cliente por su ID y obtener el cliente eliminado
    const deletedCliente = await clientes.findByIdAndDelete(clientId);

    if (!deletedCliente) {
      return res.status(404).json({ mensaje: 'Cliente no encontrado' });
    }

    emitToClients('server:cClientes', {
      tipoAction: 'delete',
      data: deletedCliente,
    });

    emitToClients('server:deleteCliente', deletedCliente);

    // Enviar el ID del cliente eliminado junto con un mensaje de éxito
    res.json(deletedCliente);
  } catch (error) {
    console.error('Error al eliminar el cliente:', error);
    res.status(500).json({ mensaje: 'Error al eliminar el cliente' });
  }
});

router.get('/buscar-cliente', async (req, res) => {
  try {
    const { query, atributo } = req.query;
    const camposPermitidos = ['nombre', 'phone', 'dni'];

    if (!camposPermitidos.includes(atributo)) {
      return res.status(400).send('Atributo no válido');
    }

    // Limpiar el query: eliminar espacios extra y dividir en palabras
    const palabras = query.trim().split(/\s+/);

    if (palabras.length === 0) {
      return res.status(400).send('Consulta vacía');
    }

    let filtro = {};

    if (palabras.length === 1) {
      // Solo una palabra
      const palabra = palabras[0].toLowerCase(); // Convertir a minúsculas para coincidencia insensible a mayúsculas

      // Crear expresión regular para verificar que la palabra está al inicio de alguna palabra
      filtro = {
        [atributo]: {
          $regex: `(?:^|\\s)${palabra}`, // Coincidencia de inicio de palabra en el campo
          $options: 'i', // Insensible a mayúsculas
        },
      };
    } else {
      // Más de una palabra
      const primeraParte = palabras[0]; // Primera palabra
      const restoPalabras = palabras.slice(1); // Todas las palabras restantes

      // Expresión regular para la primera parte: puede estar en cualquier parte
      const primeraParteRegex = new RegExp(`\\b${primeraParte}`, 'i');

      // Expresión regular para el resto de las palabras: puede estar en cualquier parte después de la primera coincidencia
      const restoPalabrasRegex = restoPalabras.map((p) => `(?=.*\\b${p})`).join('');

      // Construir filtro usando ambas expresiones regulares
      filtro = {
        [atributo]: {
          $regex: `${primeraParteRegex.source}${restoPalabrasRegex}`,
          $options: 'i',
        },
      };
    }

    // Realizar la búsqueda con el filtro construido
    const resultados = await clientes.find(filtro, [atributo, '_id']).limit(5);

    res.json(resultados);
  } catch (error) {
    console.error(error); // Añadir información adicional sobre el error
    res.status(500).send('Error en la búsqueda');
  }
});

router.get('/get-cliente/:id', async (req, res) => {
  try {
    const idCliente = req.params.id;
    let cliente = await clientes.findById(idCliente);

    if (!cliente) {
      return res.status(404).json({ mensaje: 'Cliente no encontrado' });
    }

    // Verificar si infoScore tiene más de 6 elementos
    if (cliente.infoScore.length > 6) {
      // Ordenar el array por fecha de más reciente a más antiguo
      cliente.infoScore.sort((a, b) => new Date(b.dateRegistro) - new Date(a.dateRegistro));

      // Tomar los últimos 5 elementos (más recientes)
      const recientes = cliente.infoScore.slice(0, 5);

      // Calcular el total basado en tipoPuntaje (positivo o negativo)
      let totalPuntos = recientes.reduce((acum, item) => {
        return acum + (item.tipoPuntaje === 'positivo' ? item.puntos : -item.puntos);
      }, 0);

      // Verificar si el total es menor al scoreTotal
      if (totalPuntos < cliente.scoreTotal) {
        // Calcular la diferencia para agregarla como un nuevo entry
        const diferencia = cliente.scoreTotal - totalPuntos;

        // Crear el nuevo entry que agrupa los puntos anteriores
        const nuevoEntry = {
          puntos: diferencia,
          dateRegistro: moment(recientes[recientes.length - 1].dateRegistro)
            .subtract(1, 'days')
            .toDate(), // Fecha un día antes que el más antiguo
          tipoPuntaje: 'positivo',
          medioRegistro: 'directo',
          info: {
            motivo: 'Agrupacion de puntos anteriores',
          },
        };

        // Validar que el nuevo entry tiene todos los campos requeridos
        if (
          nuevoEntry.puntos !== undefined &&
          nuevoEntry.dateRegistro &&
          nuevoEntry.tipoPuntaje &&
          nuevoEntry.medioRegistro &&
          nuevoEntry.info
        ) {
          // Actualizar el array infoScore: mantener los 5 recientes y agregar el nuevo entry
          cliente.infoScore = [...recientes, nuevoEntry];
        } else {
          console.error('Nuevo entry no válido:', nuevoEntry);
          return res.status(500).json({ mensaje: 'Error al agregar nuevo entry' });
        }
      } else if (totalPuntos > cliente.scoreTotal) {
        // Mientras el total sea mayor que scoreTotal, elimina el más antiguo de los 5 y vuelve a calcular
        while (totalPuntos > cliente.scoreTotal && recientes.length > 0) {
          recientes.pop(); // Elimina el más antiguo (último en el array)
          // Recalcular el total después de eliminar un elemento
          totalPuntos = recientes.reduce((acum, item) => {
            return acum + (item.tipoPuntaje === 'positivo' ? item.puntos : -item.puntos);
          }, 0);
        }

        // Verificar si todavía hay diferencia después de eliminar elementos
        if (totalPuntos < cliente.scoreTotal) {
          const diferencia = cliente.scoreTotal - totalPuntos;

          // Crear el nuevo entry que agrupa los puntos anteriores
          const nuevoEntry = {
            puntos: diferencia,
            dateRegistro: moment(recientes[recientes.length - 1].dateRegistro)
              .subtract(1, 'days')
              .toDate(), // Fecha un día antes que el más antiguo
            tipoPuntaje: 'positivo',
            medioRegistro: 'directo',
            info: {
              motivo: 'Agrupacion de puntos anteriores',
            },
          };

          // Validar que el nuevo entry tiene todos los campos requeridos
          if (
            nuevoEntry.puntos !== undefined &&
            nuevoEntry.dateRegistro &&
            nuevoEntry.tipoPuntaje &&
            nuevoEntry.medioRegistro &&
            nuevoEntry.info
          ) {
            // Agregar el nuevo entry a los recientes
            cliente.infoScore = [...recientes, nuevoEntry];
          } else {
            console.error('Nuevo entry no válido:', nuevoEntry);
            return res.status(500).json({ mensaje: 'Error al agregar nuevo entry' });
          }
        } else {
          cliente.infoScore = recientes; // Si no hay diferencia, solo mantener los recientes
        }
      } else {
        // Si el total es igual al scoreTotal, simplemente mantenemos los 5 más recientes
        cliente.infoScore = recientes;
      }

      // Guardar los cambios en el cliente
      await cliente.save();
    }

    // Enviar la respuesta con la información actualizada del cliente
    res.json(cliente);
  } catch (error) {
    console.error('Error al obtener el cliente:', error);
    res.status(500).json({ mensaje: 'Error al obtener el cliente' });
  }
});

router.post('/add-registro-puntos/cliente/:id', async (req, res) => {
  try {
    const idCliente = req.params.id;
    const { puntos, tipoPuntaje, medioRegistro, info } = req.body;

    // Validar que todos los datos requeridos estén presentes en la solicitud
    if (!puntos || !tipoPuntaje || !medioRegistro || !info) {
      return res.status(400).json({ mensaje: 'Todos los campos son requeridos' });
    }

    const stateUsePuntos = await checkPuntosState();

    if (!stateUsePuntos) {
      return res.status(400).json({ mensaje: 'Los puntos están deshabilitados' });
    }

    const clienteActualizado = await clientes
      .findByIdAndUpdate(
        idCliente,
        {
          $push: {
            infoScore: {
              puntos: puntos,
              tipoPuntaje,
              medioRegistro,
              dateRegistro: currentDate(),
              info,
            },
          },
          $inc: {
            scoreTotal: tipoPuntaje === 'positivo' ? puntos : -puntos,
          },
        },
        { new: true }
      )
      .lean();

    emitToClients('server:cClientes', {
      tipoAction: 'update',
      data: clienteActualizado,
    });

    emitToClients('server:updateCliente', clienteActualizado);

    res.json(clienteActualizado);
  } catch (error) {
    console.error('Error al agregar registro a infoScore:', error);
    res.status(500).json({ mensaje: 'Error al agregar registro a infoScore' });
  }
});

router.put('/unificar-clientes', async (req, res) => {
  const { ids } = req.body;

  if (!ids || ids.length < 2) {
    return res.status(400).json({ mensaje: 'Debes proporcionar al menos dos IDs para unificar' });
  }

  const session = await db.startSession();
  session.startTransaction();

  try {
    // 1. Obtener todos los clientes por sus IDs
    const listCliente = await clientes.find({ _id: { $in: ids } }).session(session);

    if (listCliente.length < ids.length) {
      throw new Error('Uno o más clientes no se encontraron');
    }

    // 2. El primer cliente en la lista será el "cliente base"
    const clienteBase = listCliente.find((cliente) => cliente._id.toString() === ids[0]);

    if (!clienteBase) {
      throw new Error('Cliente base no encontrado');
    }

    // 3. Obtener los otros clientes (que no son el cliente base)
    const clientesAUnificar = listCliente.filter((cliente) => cliente._id.toString() !== ids[0]);

    // 4. Actualizar las facturas para que apunten al cliente base
    const bulkOpsFacturas = clientesAUnificar.map((cliente) => ({
      updateMany: {
        filter: { idCliente: cliente._id.toString() },
        update: { $set: { idCliente: clienteBase._id.toString() } },
      },
    }));

    if (bulkOpsFacturas.length > 0) {
      const result = await Factura.bulkWrite(bulkOpsFacturas, { session });
    }

    // 5. Unificar la información de los otros clientes en el cliente base
    clientesAUnificar.forEach((cliente) => {
      if (!clienteBase.dni && cliente.dni) clienteBase.dni = cliente.dni;
      if (!clienteBase.nombre && cliente.nombre) clienteBase.nombre = cliente.nombre;
      if (!clienteBase.direccion && cliente.direccion) clienteBase.direccion = cliente.direccion;
      if (!clienteBase.phone && cliente.phone) clienteBase.phone = cliente.phone;
    });

    // 6. Sumar los scoreTotal de los otros clientes
    const totalScore = clientesAUnificar.reduce((acc, cliente) => acc + cliente.scoreTotal, 0);

    // 7. Si el totalScore es mayor que 0, agregar un nuevo registro en infoScore
    if (totalScore > 0) {
      clienteBase.infoScore.push({
        puntos: totalScore,
        tipoPuntaje: 'positivo',
        medioRegistro: 'directo',
        dateRegistro: new Date(),
        info: { motivo: 'Unificación de clientes' },
      });

      // Actualizar el score total del cliente base
      clienteBase.scoreTotal += totalScore;
    }

    // 8. Guardar los cambios en el cliente base
    await clienteBase.save({ session });

    // 9. Eliminar los otros clientes de la base de datos
    const bulkOpsClientes = clientesAUnificar.map((cliente) => ({
      deleteOne: { filter: { _id: cliente._id } },
    }));

    if (bulkOpsClientes.length > 0) {
      const result = await clientes.bulkWrite(bulkOpsClientes, { session });

      // Verificar si todos los documentos se eliminaron
      const eliminados = result.deletedCount;
      if (eliminados !== clientesAUnificar.length) {
        throw new Error(
          `No se eliminaron todos los clientes esperados. Eliminados: ${eliminados}, Esperados: ${clientesAUnificar.length}`
        );
      }
    }

    // 10. Commit de la transacción
    await session.commitTransaction();
    session.endSession();

    res.json({
      clienteBase,
      idClientesEliminados: clientesAUnificar.map((cliente) => cliente._id),
    });
  } catch (error) {
    // Revertir todos los cambios si hubo un error
    await session.abortTransaction();
    session.endSession();
    console.error('Error al unificar clientes:', error);
    res.status(500).json({ mensaje: 'Error al unificar clientes', error: error.message });
  }
});

export default router;
