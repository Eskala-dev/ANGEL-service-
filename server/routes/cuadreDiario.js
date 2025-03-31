import express from 'express';
import CuadreDiario from '../models/cuadreDiario.js';
import Factura from '../models/Factura.js';
import Gasto from '../models/gastos.js';
import Negocio from '../models/negocio.js';
import moment from 'moment';

import { openingHours } from '../middleware/middleware.js';
import Pagos from '../models/pagos.js';
import Usuario from '../models/usuarios/usuarios.js';
import { mapObjectByKey } from '../utils/utilsFuncion.js';
import { emitToClients } from '../socket/socketServer.js';
const router = express.Router();

export const handleGetInfoUser = async (id) => {
  try {
    // Buscar el usuario por ID y seleccionar solo los campos necesarios
    const iUser = await Usuario.findById(id).select('name usuario rol').lean();

    // Verificar si el usuario existe
    if (!iUser) {
      throw new Error(`No se encontró un usuario con el ID: ${id}`);
    }

    // Devolver la información del usuario
    return {
      _id: iUser._id,
      name: iUser.name,
      usuario: iUser.usuario,
      rol: iUser.rol,
    };
  } catch (error) {
    console.error('Error al obtener la información del usuario:', error);
    throw error; // Propagar el error para que sea manejado por el llamador
  }
};

router.post('/save-cuadre', openingHours, async (req, res) => {
  const { infoCuadre } = req.body;

  try {
    // Obtén el valor máximo actual de 'index' en tus documentos
    const maxIndex = await CuadreDiario.findOne({}, { index: 1 }, { sort: { index: -1 } });

    // Calcula el nuevo valor de 'index'
    const newIndex = maxIndex ? maxIndex.index + 1 : 1;

    // Crea un nuevo cuadre con el nuevo valor de 'index'
    const newCuadre = new CuadreDiario({ ...infoCuadre, index: newIndex });

    // Guarda el nuevo cuadre en la base de datos
    await newCuadre.save();

    const socketId = req.headers['x-socket-id'];

    emitToClients('server:changeCuadre', '', socketId);
    emitToClients('server:changeCuadre:child', '', socketId);

    res.json('Guardado Exitoso');
  } catch (error) {
    console.error('Error al Guardar Delivery:', error);
    res.status(500).json({ mensaje: 'Error al Guardar Delivery' });
  }
});

router.put('/update-cuadre/:id', openingHours, async (req, res) => {
  const { id } = req.params;
  const { infoCuadre } = req.body;

  try {
    // Actualiza el cuadre en la colección CuadreDiario
    const cuadreUpdate = await CuadreDiario.findByIdAndUpdate(id, infoCuadre, {
      new: true,
    }).lean();

    if (!cuadreUpdate) {
      return res.status(404).json({ mensaje: 'Cuadre no encontrado' });
    }

    const socketId = req.headers['x-socket-id'];

    emitToClients('server:changeCuadre', '', socketId);
    emitToClients('server:changeCuadre:child', '', socketId);

    res.json('Actualizacion Exitosa');
  } catch (error) {
    console.error('Error al actualizar el cuadre:', error);
    res.status(500).json({ mensaje: 'Error al actualizar el cuadre' });
  }
});

router.delete('/delete-cuadre/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar y eliminar el documento por ID
    const deletedCuadre = await CuadreDiario.findByIdAndDelete(id);

    if (!deletedCuadre) {
      return res.status(404).json({ mensaje: 'Cuadre no encontrado' });
    }

    const socketId = req.headers['x-socket-id'];

    // Emitir eventos a los clientes conectados
    emitToClients('server:changeCuadre', '', socketId);
    emitToClients('server:changeCuadre:child', '', socketId);

    res.json({ mensaje: 'Cuadre eliminado con éxito' });
  } catch (error) {
    console.error('Error al eliminar el cuadre:', error);
    res.status(500).json({ mensaje: 'Error al eliminar el cuadre' });
  }
});

async function obtenerInformacionDetallada(listCuadres) {
  try {
    // Recopilar todos los IDs de pagos y gastos
    const pagoIds = listCuadres.flatMap((cuadre) => cuadre.Pagos);
    const gastoIds = listCuadres.flatMap((cuadre) => cuadre.Gastos);

    // Obtener información de pagos y gastos en una sola consulta por tipo
    const pagos = await Pagos.find({ _id: { $in: pagoIds } }, { total: 1, metodoPago: 1, idOrden: 1, idUser: 1 });

    const gastos = await Gasto.find(
      { _id: { $in: gastoIds } },
      { date: 1, motivo: 1, tipo: 1, monto: 1, idUser: 1, metodoGasto: 1 }
    );

    // Recopilar todos los IDs de orden de los pagos
    const idOrdenesPagos = pagos.map((pago) => pago.idOrden);

    // Obtener información de facturas en una sola consulta
    const facturas = await Factura.find({ _id: { $in: idOrdenesPagos } }, { codRecibo: 1, Nombre: 1, delivery: 1 });

    // Mapear IDs de pagos, gastos y facturas a sus respectivos objetos
    const pagosMap = mapObjectByKey(pagos, '_id');
    const gastosMap = mapObjectByKey(gastos, '_id');
    const facturasMap = mapObjectByKey(facturas, '_id');

    // Asignar información detallada a cada cuadre
    for (let cuadre of listCuadres) {
      cuadre.Pagos = cuadre.Pagos.map((pagoId) => {
        const pago = pagosMap[pagoId];
        if (!pago) {
          console.warn(`⚠️ Pago no encontrado: ${pagoId}`);
          return null;
        }

        const factura = facturasMap[pago.idOrden];
        if (!factura) {
          console.warn(`⚠️ Factura no encontrada para idOrden: ${pago.idOrden}`);
          return null;
        }

        return {
          _id: pagoId,
          codRecibo: factura.codRecibo,
          Nombre: factura.Nombre,
          total: pago.total,
          metodoPago: pago.metodoPago,
          delivery: factura.delivery,
          idUser: pago.idUser,
        };
      }).filter(Boolean); // Filtrar elementos nulos

      cuadre.Gastos = cuadre.Gastos.map((gastoId) => {
        const gasto = gastosMap[gastoId];
        if (!gasto) {
          console.warn(`⚠️ Gasto no encontrado: ${gastoId}`);
          return null;
        }

        return {
          _id: gastoId,
          tipo: gasto.tipo,
          date: gasto.date,
          motivo: gasto.motivo,
          monto: gasto.monto,
          idUser: gasto.idUser,
          metodoGasto: gasto.metodoGasto,
        };
      }).filter(Boolean); // Filtrar elementos nulos
    }

    return listCuadres;
  } catch (error) {
    console.error('❌ Error al obtener información detallada:', error);
    throw new Error('Error al obtener información detallada');
  }
}

const handleGetMovimientosNCuadre = async (date, listCuadres) => {
  // Obtener todos los IDs de pagos y gastos de los cuadres
  const allPagosIds = new Set(listCuadres.flatMap((cuadre) => cuadre.Pagos.map((pago) => pago._id)));
  const allGastosIds = new Set(listCuadres.flatMap((cuadre) => cuadre.Gastos.map((gasto) => gasto._id)));

  // Obtener los pagos en la fecha especificada con isCounted true
  const InfoPagos = await Pagos.find({
    'date.fecha': date,
    isCounted: true,
  }).lean();

  // Obtener los gastos en la fecha especificada
  const listGastos = await Gasto.find({ 'date.fecha': date }).lean();

  // Obtener los IDs de usuarios únicos de pagos y gastos
  const uniqueUserIdsArray = [
    ...new Set([...InfoPagos.map((pago) => pago.idUser), ...listGastos.map((gasto) => gasto.idUser)]),
  ];

  // Consultar los usuarios cuyos IDs están en uniqueUserIdsArray y proyectar solo los campos deseados
  const usuarios = await Usuario.find({ _id: { $in: uniqueUserIdsArray } }, { name: 1, usuario: 1, rol: 1 }).lean();
  const UsuariosMap = new Map(usuarios.map((usuario) => [usuario._id.toString(), usuario]));

  // Obtener los IDs de orden únicos de los pagos
  const uniqueOrderIds = [...new Set(InfoPagos.map((pago) => pago.idOrden))];

  // Obtener las facturas correspondientes a los IDs de orden únicos
  const facturas = await Factura.find(
    { _id: { $in: uniqueOrderIds } },
    { Nombre: 1, delivery: 1, codRecibo: 1 }
  ).lean();
  const FacturasMap = new Map(facturas.map((factura) => [factura._id.toString(), factura]));

  // Mapear los pagos con la información de las facturas
  const listPagos = InfoPagos.map((pago) => {
    const factura = FacturasMap.get(pago.idOrden);
    return {
      _id: pago._id,
      idUser: pago.idUser,
      codRecibo: factura ? factura.codRecibo : null,
      idOrden: pago.idOrden,
      date: pago.date,
      Nombre: factura ? factura.Nombre : null,
      total: pago.total,
      metodoPago: pago.metodoPago,
      delivery: factura ? factura.delivery : null,
      detail: pago.detail,
      isCounted: true,
      infoUser: UsuariosMap.get(pago.idUser),
    };
  });

  // Filtrar los pagos y gastos que no están en los IDs de cuadres
  const pagosNCuadre = listPagos.filter((pago) => !allPagosIds.has(pago._id.toString()));
  const gastosNCuadre = await Promise.all(
    listGastos
      .filter((gasto) => !allGastosIds.has(gasto._id.toString()))
      .map(async (gasto) => ({
        ...gasto,
        infoUser: UsuariosMap.get(gasto.idUser),
      }))
  );

  return { pagosNCuadre, gastosNCuadre };
};

router.get('/get-cuadre/:idUsuario/:datePrincipal', async (req, res) => {
  try {
    const { idUsuario, datePrincipal } = req.params;

    const infoNegocio = await Negocio.findOne({}, { typeSavedOnCuadre: 1 }).lean();
    if (!infoNegocio) {
      return res.status(404).json({ message: 'Hubo un error al traer informacion de negocio' });
    }

    const typeSavedOnCuadre = infoNegocio.typeSavedOnCuadre;

    // Generar el rango de fecha utilizando Moment.js
    const startOfDay = moment(datePrincipal).startOf('day').toDate();
    const endOfDay = moment(datePrincipal).endOf('day').toDate();

    // Filtro base para el rango de fecha
    let filter = { date: { $lte: moment().endOf('day').toDate() } };

    // Si es "user", agregar el filtro para el usuario
    if (typeSavedOnCuadre === 'user') {
      filter['savedInNameOf.idUsuario'] = idUsuario;
    }

    const ultimoCuadre = await CuadreDiario.findOne()
      .sort({ date: -1 }) // Ordenar por fecha descendente
      .lean();

    // Buscar el último registro basado en la fecha proporcionada
    let lastCuadreByTypeSaved = await CuadreDiario.findOne(filter)
      .sort({ date: -1 }) // Ordenar por fecha descendente
      .lean();

    // 2. Buscar por la fecha dada.
    let listCuadres = await CuadreDiario.find({
      date: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    }).lean();

    listCuadres = await obtenerInformacionDetallada(listCuadres);
    if (lastCuadreByTypeSaved !== null) {
      const [infoDetailLastCuadre] = await obtenerInformacionDetallada([lastCuadreByTypeSaved]);
      lastCuadreByTypeSaved = infoDetailLastCuadre;
    }

    // Obtener la información del usuario y su rol
    const usuario = await Usuario.findById(idUsuario, 'rol name').lean();

    const dPrincipal = moment(datePrincipal, 'YYYY-MM-DD');

    // 3. Agregar atributo 'enable' a cada elemento de listCuadres.
    if (listCuadres.length > 0) {
      const uCuadre = typeSavedOnCuadre === 'user' && lastCuadreByTypeSaved ? lastCuadreByTypeSaved : ultimoCuadre;
      const dLastCuadre = moment(uCuadre.date, 'YYYY-MM-DD');

      listCuadres = listCuadres.map((elemento) => {
        if (
          dPrincipal.isSame(dLastCuadre, 'day') &&
          elemento._id.toString() === uCuadre._id.toString() &&
          elemento.savedInNameOf.idUsuario === idUsuario &&
          elemento.tipoGuardado === typeSavedOnCuadre
        ) {
          return {
            ...elemento,
            type: usuario ? 'update' : 'view',
            isRemovable: true,
            enable: usuario ? false : true,
            saved: true,
          };
        } else {
          return { ...elemento, type: 'view', isRemovable: false, enable: true, saved: true };
        }
      });
    }

    const infoBase = {
      date: moment(datePrincipal).toDate(),
      cajaInicial: 0,
      suggestion: {
        estado: false,
        info: null,
      },
      incuerencia: false,
      Montos: [],
      estado: '',
      margenError: 0,
      corte: 0,
      cajaFinal: 0,
      ingresos: {
        efectivo: '',
        transferencia: '',
        tarjeta: '',
      },
      egresos: 0,
      notas: [],
      Pagos: [],
      Gastos: [],
      savedBy: {
        idUsuario: idUsuario,
        nombre: usuario ? usuario.name : 'Desconocido',
      },
      savedInNameOf: {
        idUsuario: idUsuario,
        nombre: usuario ? usuario.name : 'Desconocido',
      },
      tipoGuardado: typeSavedOnCuadre,
    };

    let cuadreActual = infoBase;

    if (ultimoCuadre) {
      const dLastCuadre = moment(ultimoCuadre.date, 'YYYY-MM-DD');
      if (lastCuadreByTypeSaved) {
        if (dPrincipal.isSame(dLastCuadre, 'day')) {
          console.log('=');
          // =
          const date = moment(lastCuadreByTypeSaved.date, 'YYYY-MM-DD');
          if (dPrincipal.isSame(date, 'day')) {
            if (lastCuadreByTypeSaved.tipoGuardado === typeSavedOnCuadre) {
              if (idUsuario === lastCuadreByTypeSaved.savedInNameOf.idUsuario.toString()) {
                cuadreActual = {
                  ...lastCuadreByTypeSaved,
                  type: usuario ? 'update' : 'view',
                  isRemovable: true,
                  enable: usuario ? false : true,
                  saved: true,
                };
              } else {
                cuadreActual = {
                  ...cuadreActual,
                  suggestion: {
                    estado: true,
                    info: {
                      idCuadre: lastCuadreByTypeSaved._id,
                      cajaInicialSugerida: lastCuadreByTypeSaved.cajaFinal,
                      fechaCuadre: lastCuadreByTypeSaved.date,
                      responsable: lastCuadreByTypeSaved.savedInNameOf.nombre,
                    },
                  },
                  cajaInicial: lastCuadreByTypeSaved.cajaFinal,
                  type: 'new',
                  isRemovable: false,
                  enable: false,
                  saved: false,
                };
              }
            } else {
              cuadreActual = {
                ...cuadreActual,
                type: 'new',
                isRemovable: false,
                enable: false,
                saved: false,
              };
            }
          } else {
            // <
            if (lastCuadreByTypeSaved.tipoGuardado === typeSavedOnCuadre) {
              cuadreActual = {
                ...cuadreActual,
                suggestion: {
                  estado: true,
                  info: {
                    idCuadre: lastCuadreByTypeSaved._id,
                    cajaInicialSugerida: lastCuadreByTypeSaved.cajaFinal,
                    fechaCuadre: lastCuadreByTypeSaved.date,
                    responsable: lastCuadreByTypeSaved.savedInNameOf.nombre,
                  },
                },
                cajaInicial: lastCuadreByTypeSaved.cajaFinal,
                type: 'new',
                isRemovable: false,
                enable: false,
                saved: false,
              };
            } else {
              cuadreActual = {
                ...cuadreActual,
                type: 'new',
                isRemovable: false,
                enable: false,
                saved: false,
              };
            }
          }
        } else if (dPrincipal.isBefore(dLastCuadre, 'day')) {
          console.log('<');
          // <
          if (listCuadres.length > 0) {
            const lastCuadreOfList = listCuadres[listCuadres.length - 1];
            //   if (typeSavedOnCuadre === 'user') {
            if (typeSavedOnCuadre === lastCuadreByTypeSaved.tipoGuardado) {
              const isSameUserAndCuadre =
                lastCuadreByTypeSaved.savedInNameOf.idUsuario.toString() ===
                  lastCuadreOfList.savedInNameOf.idUsuario.toString() &&
                lastCuadreByTypeSaved._id.toString() === lastCuadreOfList._id;

              cuadreActual = {
                ...lastCuadreOfList,
                type: isSameUserAndCuadre && usuario ? 'update' : 'view',
                isRemovable: isSameUserAndCuadre ? true : false,
                enable: isSameUserAndCuadre && usuario ? false : true,
                saved: true,
              };
            } else {
              cuadreActual = {
                ...lastCuadreOfList,
                type: 'view',
                isRemovable: false,
                enable: true,
                saved: true,
              };
            }
          } else {
            cuadreActual = {
              ...cuadreActual,
              type: 'view',
              isRemovable: false,
              enable: true,
              saved: false,
            };
          }
        } else if (dPrincipal.isAfter(dLastCuadre, 'day')) {
          console.log('>');
          // >
          if (ultimoCuadre.tipoGuardado === typeSavedOnCuadre) {
            cuadreActual = {
              ...cuadreActual,
              cajaInicial: lastCuadreByTypeSaved.cajaFinal,
              suggestion: {
                estado: true,
                info: {
                  idCuadre: lastCuadreByTypeSaved._id,
                  cajaInicialSugerida: lastCuadreByTypeSaved.cajaFinal,
                  fechaCuadre: lastCuadreByTypeSaved.date,
                  responsable: lastCuadreByTypeSaved.savedInNameOf.nombre,
                },
              },
              type: 'new',
              isRemovable: false,
              enable: false,
              saved: false,
            };
          } else {
            cuadreActual = {
              ...cuadreActual,
              type: 'new',
              isRemovable: false,
              enable: false,
              saved: false,
            };
          }
        }
      } else {
        if (dPrincipal.isSameOrAfter(dLastCuadre, 'day')) {
          console.log('>=');
          // >=
          cuadreActual = {
            ...cuadreActual,
            type: 'new',
            isRemovable: false,
            enable: false,
            saved: false,
          };
        } else {
          console.log('<');
          // <
          if (listCuadres.length > 0) {
            cuadreActual = {
              ...listCuadres[listCuadres.length - 1],
              type: 'view',
              isRemovable: false,
              enable: true,
              saved: true,
            };
          } else {
            cuadreActual = {
              ...cuadreActual,
              type: 'view',
              isRemovable: false,
              enable: true,
              saved: false,
            };
          }
        }
      }
    }

    const MovimientosNCuadre = await handleGetMovimientosNCuadre(datePrincipal, listCuadres);

    let { pagosNCuadre, gastosNCuadre } = MovimientosNCuadre;

    res.json({
      listCuadres: listCuadres.length > 0 ? listCuadres : [],
      lastCuadre: lastCuadreByTypeSaved
        ? {
            ...lastCuadreByTypeSaved,
            type: usuario ? 'update' : 'view',
            isRemovable: true,
            enable: usuario ? false : true,
            saved: true,
          }
        : null,
      cuadreActual: cuadreActual,
      infoBase,
      registroNoCuadrados: {
        pagos: pagosNCuadre.length > 0 ? pagosNCuadre : [],
        gastos: gastosNCuadre.length > 0 ? gastosNCuadre : [],
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error en el servidor: ' + error.message);
  }
});

// Función optimizada para obtener la lista de fechas de un mes
const handleGetListFechas = (date) => {
  const fechas = [];
  // Convertir la cadena de fecha en un objeto moment para la fecha de entrada
  const inputDate = moment(date, 'YYYY-MM-DD');
  // Convertir la cadena de fecha en un objeto moment para la fecha actual
  const currentDate = moment().startOf('day');

  // Verificar si la fecha de entrada es de un mes y año futuros respecto a la fecha actual
  if (inputDate.isAfter(currentDate, 'month') || inputDate.year() > currentDate.year()) {
    // Retornar array vacío si es futuro
    return fechas;
  }

  // Extraer el año y el mes directamente de la fecha de entrada
  const year = inputDate.year();
  const month = inputDate.month() + 1; // moment.js cuenta los meses desde 0

  // Iniciar en el primer día del mes del parámetro date
  let currentDateStartOfMonth = moment(`${year}-${month}-01`, 'YYYY-MM-DD');
  // Determinar si la fecha de entrada corresponde al mes y año actual
  const isCurrentMonth = currentDate.year() === year && currentDate.month() + 1 === month;
  // Usar la fecha actual como última fecha si es el mes actual, de lo contrario usar el último día del mes de entrada
  const lastDate = isCurrentMonth ? currentDate : currentDateStartOfMonth.clone().endOf('month');

  while (currentDateStartOfMonth.isSameOrBefore(lastDate, 'day')) {
    fechas.push(currentDateStartOfMonth.format('YYYY-MM-DD'));
    currentDateStartOfMonth.add(1, 'day');
  }

  // Asegurar que no se incluyan fechas del mes siguiente
  return fechas.filter((fecha) => moment(fecha).month() === inputDate.month());
};

router.get('/get-list-cuadre/mensual/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const listaFechas = handleGetListFechas(date);

    // Definir el rango del mes en UTC
    const startOfMonth = moment(date, 'YYYY-MM-DD').startOf('month').toDate();
    const endOfMonth = moment(date, 'YYYY-MM-DD').endOf('month').toDate();

    // Obtener los cuadres mensuales dentro del rango
    const cuadresMensuales = await CuadreDiario.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
    }).lean();

    // Mapear los cuadres a un objeto con clave YYYY-MM-DD
    const cuadresMap = cuadresMensuales.reduce((acc, item) => {
      const fechaKey = moment(item.date).format('YYYY-MM-DD'); // Corrige el acceso a item.date
      if (!acc[fechaKey]) acc[fechaKey] = [];
      acc[fechaKey].push(item);
      return acc;
    }, {});

    // Procesar los resultados por cada fecha de listaFechas
    const resultadosPorFecha = await Promise.all(
      listaFechas.map(async (fecha) => {
        const cuadreDiarios = cuadresMap[fecha] || [];

        const listCuadres = await obtenerInformacionDetallada(cuadreDiarios);
        const { pagosNCuadre, gastosNCuadre } = await handleGetMovimientosNCuadre(fecha, listCuadres);

        const cuadresTransformados = cuadreDiarios.map((cuadre) => ({
          _id: cuadre._id,
          cajaInicial: cuadre.cajaInicial,
          montoCaja: cuadre.Montos.reduce((total, monto) => total + +monto.total, 0).toFixed(1),
          estado: cuadre.estado,
          margenError: cuadre.margenError,
          corte: cuadre.corte,
          cajaFinal: cuadre.cajaFinal,
          ingresos: cuadre.ingresos,
          egresos: cuadre.egresos,
          notas: cuadre.notas,
          infoUser: cuadre.savedInNameOf.nombre,
          suggestion: cuadre.suggestion,
          incuerencia: cuadre.incuerencia,
        }));

        return {
          fecha,
          cuadresTransformados,
          paysNCuadrados: pagosNCuadre,
          gastoGeneral: gastosNCuadre,
        };
      })
    );

    res.json(resultadosPorFecha);
  } catch (error) {
    console.error('Error en la API:', error);
    res.status(500).json({ error: 'Error en el servidor', mensaje: error.message });
  }
});

router.get('/get-movimientos-saved/cuadre/:date', async (req, res) => {
  try {
    const { date } = req.params;

    // Convertir la fecha a rango (inicio y fin del día)
    const startOfDay = moment(date).startOf('day').toDate();
    const endOfDay = moment(date).endOf('day').toDate();

    // Buscar documentos en el rango de fecha
    const cuadreDiarios = await CuadreDiario.find(
      { date: { $gte: startOfDay, $lte: endOfDay } },
      { Pagos: 1, Gastos: 1, _id: 0 } // Proyectar solo Pagos y Gastos
    );

    // Unir todos los pagos y gastos
    const Pagos = cuadreDiarios.flatMap((doc) => doc.Pagos || []);
    const Gastos = cuadreDiarios.flatMap((doc) => doc.Gastos || []);

    res.json({ Pagos, Gastos });
  } catch (error) {
    console.error('Error en /get-pagos/cuadre:', error);
    res.status(500).send('Error en el servidor: ' + error.message);
  }
});

router.get('/get-cuadres/grouped-by-user/:date', async (req, res) => {
  try {
    const { date } = req.params;

    // Generar rango de fechas
    const startOfDay = moment(date).startOf('day').toDate();
    const endOfDay = moment(date).endOf('day').toDate();

    // Obtener los cuadres del día
    const cuadres = await CuadreDiario.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    }).lean();

    // Si no hay cuadres, retornar un array vacío
    if (!cuadres.length) {
      return res.json([]);
    }

    const infoNegocio = await Negocio.findOne({}, { typeSavedOnCuadre: 1 }).lean();
    if (!infoNegocio) {
      return res.status(404).json({ message: 'Hubo un error al traer información del negocio' });
    }

    const { typeSavedOnCuadre } = infoNegocio;

    // Obtener todos los usuarios únicos
    const usuariosUnicos = Array.from(new Set(cuadres.map((cuadre) => cuadre.savedInNameOf.idUsuario)));

    // Determinar el último cuadre por tipo
    let lastCuadresByType = {};
    if (typeSavedOnCuadre === 'last') {
      const lastCuadre = await CuadreDiario.findOne().sort({ date: -1 }).lean();
      if (lastCuadre) {
        lastCuadresByType[lastCuadre._id] = true;
      }
    } else if (typeSavedOnCuadre === 'user') {
      for (const idUsuario of usuariosUnicos) {
        const lastCuadre = await CuadreDiario.findOne({
          'savedInNameOf.idUsuario': idUsuario,
        })
          .sort({ date: -1 })
          .lean();
        if (lastCuadre) {
          lastCuadresByType[lastCuadre._id] = true;
        }
      }
    }

    // Mapear los datos finales
    const datos = cuadres.reduce((acc, cuadre) => {
      const { idUsuario, nombre } = cuadre.savedInNameOf;

      // Buscar o crear entrada para el usuario
      let usuario = acc.find((item) => item.idUsuario === idUsuario);
      if (!usuario) {
        usuario = {
          idUsuario,
          nombre,
          listCuadres: [],
        };
        acc.push(usuario);
      }

      // Agregar el cuadre con la información `isLast`
      usuario.listCuadres.push({
        idCuadre: cuadre._id,
        date: moment(cuadre.date).format('YYYY-MM-DD - h:mm a'),
        isLast: !!lastCuadresByType[cuadre._id],
      });

      return acc;
    }, []);

    res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error en el servidor: ' + error.message);
  }
});

export default router;
