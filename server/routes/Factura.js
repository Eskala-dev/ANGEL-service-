import express from 'express';
import Factura from '../models/Factura.js';
import { openingHours } from '../middleware/middleware.js';
import codFactura from '../models/codigoFactura.js';
import clientes from '../models/clientes.js';
import Cupones from '../models/cupones.js';
import Negocio from '../models/negocio.js';
import db from '../config/db.js';
import moment from 'moment';
import Anular from '../models/anular.js';
import Almacen from '../models/almacen.js';
import Producto from '../models/portafolio/productos/productos.js';

import Pagos from '../models/pagos.js';

import { mapArrayByKey, mapObjectByKey, currentDate } from '../utils/utilsFuncion.js';
import { handleAddPago } from './pagos.js';
import { handleAddGasto } from './gastos.js';
import Usuarios from '../models/usuarios/usuarios.js';
import MovimientoProducto from '../models/portafolio/productos/movimientosProducto.js';

import { checkPuntosState } from './puntos.js';
import { emitToClients } from '../socket/socketServer.js';

const router = express.Router();

async function handleAddFactura(data, session) {
  const { infoOrden, isNewCliente, infoPago } = data;
  const {
    codRecibo,
    infoRecepcion,
    delivery,
    Nombre,
    idCliente,
    Items,
    celular,
    direccion,
    datePrevista,
    infoEntrega,
    descuento,
    estado,
    dni,
    subTotal,
    totalNeto,
    cargosExtras,
    modeRegistro,
    gift_promo,
    typeRegistro,
  } = infoOrden;

  let infoCliente;
  let newOrden;
  let newCodigo;
  let newGasto;
  let newPago;

  const fechaActual = moment().format('YYYY-MM-DD');
  const horaActual = moment().format('HH:mm');

  // 1. ADD CLIENTE
  if (estado === 'registrado' && !idCliente && isNewCliente) {
    const nuevoCliente = new clientes({
      dni,
      nombre: Nombre,
      direccion,
      phone: celular,
      infoScore: [],
      scoreTotal: 0,
    });
    await nuevoCliente.save({ session });

    infoCliente = {
      tipoAction: 'add',
      data: nuevoCliente.toObject(),
    };
  }

  // 2. UPDATE CUPON: (SI USO)
  if (descuento.estado && descuento.modoDescuento === 'Promocion' && descuento.info) {
    if (descuento.info.modo === 'CODIGO') {
      const cupon = await Cupones.findOne({
        codigoCupon: descuento.info.codigoCupon,
      });
      if (cupon) {
        cupon.estado = false;
        cupon.dateUse.fecha = fechaActual;
        cupon.dateUse.hora = horaActual;
        await cupon.save({ session });
      }
    }
  }
  // 3. ADD GASTO
  if (delivery) {
    if (data.hasOwnProperty('infoGastoByDelivery')) {
      const { infoGastoByDelivery } = data;
      if (infoGastoByDelivery) {
        newGasto = await handleAddGasto(infoGastoByDelivery);
      }
    }
  }

  // 4. ADD CUPON
  if (gift_promo.length > 0) {
    for (const gift of gift_promo) {
      const { codigoPromocion, codigoCupon } = gift;

      const nuevoCupon = new Cupones({
        codigoPromocion,
        codigoCupon,
        estado: true,
        dateCreation: {
          fecha: fechaActual,
          hora: horaActual,
        },
        dateUse: {
          fecha: '',
          hora: '',
        },
      });

      await nuevoCupon.save({ session });
    }
  }

  let nuevoCodigo;
  if (modeRegistro === 'nuevo') {
    const infoCodigo = await codFactura.findOne().sort({ _id: -1 }).lean();
    nuevoCodigo = infoCodigo.codActual;
  } else {
    nuevoCodigo = codRecibo;
  }

  const itemsTipoProductos = Items.filter((item) => item.tipo === 'producto');
  // Agrupar productos por identificador y sumar sus cantidades
  const infoProductos = Object.values(
    itemsTipoProductos.reduce((acc, item) => {
      if (!acc[item.identificador]) {
        acc[item.identificador] = { _id: item.identificador, nombre: item.item, stockPrincipal: 0 };
      }
      acc[item.identificador].stockPrincipal += item.cantidad;
      return acc;
    }, {})
  );

  let productosUpdated = [];
  // SOLO SI ES NUEVO SE ACTUALIZA EL STOCK DE PRODUCTOS
  if (infoProductos.length > 0 && modeRegistro === 'nuevo') {
    // Obtener los identificadores de los productos agrupados
    const idsProductos = infoProductos.map((item) => item._id);

    // Consultar los productos en la base de datos
    const productos = await Producto.find({ _id: { $in: idsProductos } }, { _id: 1, stockPrincipal: 1 }).lean();
    const productosMap = mapObjectByKey(productos, '_id');

    // Verificar si todos los productos fueron encontrados
    const productosNoEncontrados = infoProductos.filter((producto) => !productosMap[producto._id]);
    if (productosNoEncontrados.length > 0) {
      const nombresNoEncontrados = productosNoEncontrados.map((producto) => producto.nombre).join(', ');
      throw new Error(`Producto no encontrado: ${nombresNoEncontrados}`);
    }

    // Preparar las operaciones bulk
    const bulkOperations = infoProductos
      .map((ipro) => {
        const producto = productosMap[ipro._id];

        if (ipro.stockPrincipal > 0) {
          if (ipro.stockPrincipal <= producto.stockPrincipal) {
            producto.stockPrincipal -= ipro.stockPrincipal;
            return {
              updateOne: {
                filter: { _id: producto._id },
                update: { $inc: { stockPrincipal: -ipro.stockPrincipal } },
                session,
              },
            };
          } else {
            throw new Error(`Stock insuficiente para el producto: ${ipro.nombre}`);
          }
        }
      })
      .filter(Boolean);

    if (bulkOperations.length > 0) {
      await Producto.bulkWrite(bulkOperations);
    }

    // Devolver el array de objetos con _id y la cantidad restante
    productosUpdated = infoProductos.map((ipro) => ({
      _id: ipro._id,
      stockPrincipal: productosMap[ipro._id].stockPrincipal,
    }));
  }

  // 5. ADD ORDEN DE SERVICIO
  const nuevoOrden = new Factura({
    codRecibo: nuevoCodigo,
    dateCreation: currentDate(),
    infoRecepcion,
    delivery,
    Nombre,
    idCliente: infoCliente ? infoCliente.data._id : idCliente,
    stateLavado: 'inProgress',
    Items,
    celular,
    direccion,
    datePrevista,
    infoEntrega,
    descuento,
    estadoPrenda: 'pendiente',
    estado,
    listPago: [],
    dni,
    subTotal,
    totalNeto,
    cargosExtras,
    modeRegistro,
    notas: [],
    gift_promo,
    location: 1,
    lastEdit: [],
    typeRegistro,
  });

  newOrden = await nuevoOrden.save({ session });
  newOrden = newOrden.toObject();

  if (infoProductos.length > 0 && modeRegistro === 'nuevo') {
    const listNewsMovimientos = infoProductos.map((ipro) => {
      return {
        idProducto: ipro._id,
        accion: 'venta',
        cantidad: ipro.stockPrincipal,
        tipo: 'negativo',
        info: {
          idOrden: newOrden._id.toString(),
          codigoOrden: nuevoCodigo,
        },
      };
    });

    await MovimientoProducto.insertMany(listNewsMovimientos, { session });
  }

  let nuevoPago;
  // 6. ADD PAGO
  if (infoPago) {
    nuevoPago = await handleAddPago(
      {
        ...infoPago,
        idOrden: newOrden._id,
      },
      session
    );
  }

  // 7. UPDATE CLIENTE
  if (idCliente && descuento.estado && descuento.info && descuento.modoDescuento === 'Puntos') {
    try {
      // Buscar y actualizar el cliente si existe
      const clienteActualizado = await clientes
        .findByIdAndUpdate(
          newOrden.idCliente,
          {
            $inc: { scoreTotal: -descuento.info.puntosUsados },
            $push: {
              infoScore: {
                puntos: descuento.info.puntosUsados,
                tipoPuntaje: 'negativo',
                medioRegistro: 'servicio',
                dateRegistro: currentDate(),
                info: {
                  idOrden: newOrden._id.toString(),
                  codigoOrden: newOrden.codRecibo,
                },
              },
            },
          },
          { new: true } // Devuelve el documento actualizado
        )
        .lean();

      // Si el cliente no se encuentra, no se hace nada
      if (!clienteActualizado) {
        console.log('Cliente no encontrado.');
      } else {
        infoCliente = {
          tipoAction: 'update',
          data: clienteActualizado,
        };
      }
    } catch (error) {
      console.error('Error al buscar o actualizar el cliente:', error);
      throw new Error('Error al buscar o actualizar el cliente');
    }
  }

  // 8. UPDATE INFO CODIGO
  if (modeRegistro === 'nuevo') {
    newCodigo = await codFactura.findOneAndUpdate({}, { $inc: { codActual: 1 } }, { new: true, session });

    if (newCodigo) {
      if (newCodigo.codActual > newCodigo.codFinal) {
        newCodigo.codActual = 1;
        await newCodigo.save({ session });
      }
    } else {
      throw new Error('Código de factura no encontrado');
    }
  }

  // 9. UPDATE "listPago" con los ids de los pagos en FACTURA
  if (nuevoPago) {
    // Actualizar la newOrden con los nuevos ids de pago
    await Factura.findByIdAndUpdate(newOrden._id, { $set: { listPago: [nuevoPago._id] } }, { session });

    newPago = {
      ...nuevoPago,
      codRecibo: newOrden.codRecibo,
      Nombre: newOrden.Nombre,
      delivery: newOrden.delivery,
    };
  }

  return {
    newOrder: {
      ...newOrden,
      listPago: newPago ? [newPago._id] : [],
      ListPago: newPago ? [newPago] : [],
    },
    newPago,
    newGasto,
    infoCliente,
    newCodigo,
    productosUpdated,
  };
}

router.post('/add-factura', openingHours, async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { infoUser, ...resData } = req.body;

    const result = await handleAddFactura(resData, session);
    const { newOrder, newPago, newGasto, infoCliente, newCodigo, productosUpdated } = result;

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];

    productosUpdated.length > 0 && emitToClients('service:updatedProductos', productosUpdated);
    newPago &&
      emitToClients(
        'server:cPago',
        {
          tipo: 'added',
          info: {
            ...newPago,
            infoUser,
          },
        },
        socketId
      );
    newGasto && emitToClients('server:cGasto', newGasto);
    infoCliente && emitToClients('server:cClientes', infoCliente);
    emitToClients('server:updateCodigo', newCodigo.codActual);
    emitToClients(
      'server:changeOrder',
      {
        tipo: 'add',
        info: {
          ...newOrder,
          ListPago: newOrder.ListPago.map((pago) => ({ ...pago, infoUser })),
        },
      },
      socketId
    );

    res.json({
      ...newOrder,
      ListPago: newOrder.ListPago.map((pago) => ({ ...pago, infoUser })),
    });
  } catch (error) {
    console.error('Error al guardar los datos:', error);
    await session.abortTransaction();
    res.status(500).json({ mensaje: error.message });
  } finally {
    session.endSession();
  }
});

router.get('/get-factura/:id', (req, res) => {
  const { id } = req.params; // Obteniendo el id desde los parámetros de la URL
  Factura.findById(id)
    .then((factura) => {
      if (factura) {
        res.json(factura);
      } else {
        res.status(404).json({ mensaje: 'Factura no encontrada' });
      }
    })
    .catch((error) => {
      console.error('Error al obtener los datos:', error);
      res.status(500).json({ mensaje: 'Error al obtener los datos' });
    });
});

// Función para buscar facturas y procesar resultados
const handleGetInfoDetallada = async (ordenes) => {
  // Obtener todos los IDs de pagos y donaciones relevantes
  const idsPagos = ordenes.flatMap((orden) => orden.listPago);

  // Consultar todos los pagos
  const pagos = await Pagos.find({ _id: { $in: idsPagos } }).lean();

  // Obtener todos los IDs de usuarios únicos de los pagos
  const idUsers = [...new Set(pagos.map((pago) => pago.idUser))];

  // Buscar la información de los usuarios relacionados con los idUsers
  const usuarios = await Usuarios.find(
    { _id: { $in: idUsers } },
    {
      _id: 1,
      name: 1,
      usuario: 1,
      rol: 1,
    }
  ).lean();

  // Crear un mapa de usuarios por su _id
  const usuariosMap = mapObjectByKey(usuarios, '_id');

  // Crear un mapa de pagos por ID de orden para un acceso más rápido
  const pagosPorOrden = mapArrayByKey(pagos, 'idOrden');

  // Procesar cada orden de factura
  const resultados = ordenes.map((orden) => {
    // Obtener los pagos asociados a la orden actual
    const pagosAsociados = pagosPorOrden[orden._id] || [];

    // Mapear cada pago asociado para agregar la información del usuario y detalles de la orden
    const pagosConInfo = pagosAsociados.map((pago) => ({
      infoUser: usuariosMap[pago.idUser],
      codRecibo: orden.codRecibo,
      Nombre: orden.Nombre,
      delivery: orden.delivery,
      ...pago,
    }));

    // Devolver la orden con la lista de pagos enriquecida
    return {
      ...orden,
      ListPago: pagosConInfo,
    };
  });

  return resultados;
};

router.get('/get-factura/date-range/:startDate/:endDate', async (req, res) => {
  const { startDate, endDate } = req.params;

  try {
    // Buscar todas las facturas dentro del rango de fechas en base a infoRecepcion.fecha
    const ordenes = await Factura.find({
      $or: [
        { 'infoRecepcion.fecha': { $gte: new Date(startDate), $lte: new Date(endDate) } },
        { estadoPrenda: 'pendiente' },
      ],
    }).lean();

    const infoFormateada = await handleGetInfoDetallada(ordenes);
    res.status(200).json(infoFormateada);
  } catch (error) {
    console.error('Error al obtener datos: ', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});

router.get('/get-order/last', async (req, res) => {
  try {
    // Obtener solo el valor de maxConsultasDefault
    const negocio = await Negocio.findOne({}, { maxConsultasDefault: 1, _id: 0 }).lean();

    // Verificar si el documento de Negocio existe
    if (!negocio) {
      return res.status(404).json({ mensaje: 'No se encontró el documento de Negocio' });
    }

    const maxConsultasDefault = negocio.maxConsultasDefault;

    // Obtener los últimos documentos
    const ultimos = await Factura.find()
      .sort({ _id: -1 }) // Ordenar por _id en orden descendente para obtener los más recientes
      .limit(maxConsultasDefault) // Limitar la cantidad de documentos
      .lean();

    // Obtener los IDs de los documentos obtenidos
    const ultimosPendientesIds = ultimos
      .filter((factura) => factura.estadoPrenda === 'pendiente')
      .map((factura) => factura._id);

    // Obtener los documentos pendientes que no están en los últimos obtenidos
    const pendientes = await Factura.find({
      estadoPrenda: 'pendiente',
      _id: { $nin: ultimosPendientesIds }, // Excluir los IDs de los últimos documentos
    }).lean();

    // Combinar ambos conjuntos de documentos
    const ordenes = [...pendientes, ...ultimos];

    // Formatear la información detallada
    const infoFormateada = await handleGetInfoDetallada(ordenes);

    // Enviar respuesta exitosa
    res.status(200).json(infoFormateada);
  } catch (error) {
    console.error('Error al obtener datos: ', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});

router.get('/get-factura/date/:date', async (req, res) => {
  const { date } = req.params;

  // Obtener el primer y último día del mes como objetos Date
  const startDate = moment(date, 'YYYY-MM-DD').startOf('month').toDate();
  const endDate = moment(date, 'YYYY-MM-DD').endOf('month').toDate();

  try {
    // Buscar todas las facturas dentro del rango de fechas
    const ordenes = await Factura.find({
      'infoRecepcion.fecha': {
        $gte: startDate,
        $lte: endDate,
      },
    }).lean();

    // Formatear la información si es necesario
    const infoFormateada = await handleGetInfoDetallada(ordenes);
    res.status(200).json(infoFormateada);
  } catch (error) {
    console.error('Error al obtener datos: ', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});

// ACTUALIZA INFORMACION DE UNA ORDEN RESERVADO
router.put('/update-factura/finalizar-reserva/:id', openingHours, async (req, res) => {
  const session = await db.startSession();
  session.startTransaction(); // Comienza una transacción

  try {
    const facturaId = req.params.id;
    const { infoOrden, isNewCliente, infoPago } = req.body;

    const {
      codRecibo,
      infoRecepcion,
      delivery,
      Nombre,
      idCliente,
      Items,
      celular,
      direccion,
      datePrevista,
      descuento,
      dni,
      subTotal,
      totalNeto,
      cargosExtras,
      gift_promo,
    } = infoOrden;

    let idCli = '';
    let infoCliente;
    let newPago;

    const fechaActual = moment().format('YYYY-MM-DD');
    const horaActual = moment().format('HH:mm');

    // 1. ADD O UPDATE CLIENTE
    if (idCliente) {
      idCli = idCliente;
      // SI USO PUNTOS ACTUALIZAR RESTANDO SCORE
      if (descuento.modoDescuento === 'Puntos' && descuento.info?.puntosUsados > 0 && descuento.estado) {
        const clienteActualizado = await clientes
          .findByIdAndUpdate(
            idCliente,
            {
              $inc: { scoreTotal: -descuento.info.puntosUsados },
              $push: {
                infoScore: {
                  puntos: descuento.info.puntosUsados,
                  tipoPuntaje: 'negativo',
                  medioRegistro: 'servicio',
                  dateRegistro: currentDate(),
                  info: {
                    idOrden: facturaId.toString(),
                    codigoOrden: codRecibo,
                  },
                },
              },
            },
            { new: true } // Devuelve el documento actualizado
          )
          .lean();

        // Si el cliente no se encuentra, no se hace nada
        if (!clienteActualizado) {
          console.log('Cliente no encontrado.');
        } else {
          infoCliente = {
            tipoAction: 'update',
            data: clienteActualizado,
          };
        }
      }
    } else {
      if (isNewCliente) {
        // CREAR NEUVO CLIENTE
        const nuevoCliente = new clientes({
          dni,
          nombre: Nombre,
          direccion,
          phone: celular,
          infoScore: [],
          scoreTotal: 0,
        });
        await nuevoCliente.save({ session });

        idCli = nuevoCliente._id.toString();

        infoCliente = {
          tipoAction: 'add',
          data: nuevoCliente.toObject(),
        };
      }
    }

    // 2. ADD CUPON
    if (gift_promo.length > 0) {
      for (const gift of gift_promo) {
        const { codigoPromocion, codigoCupon } = gift;

        const nuevoCupon = new Cupones({
          codigoPromocion,
          codigoCupon,
          estado: true,
          dateCreation: {
            fecha: fechaActual,
            hora: horaActual,
          },
          dateUse: {
            fecha: '',
            hora: '',
          },
        });

        await nuevoCupon.save({ session });
      }
    }

    // 3. UPDATE CUPON: (SI USO)
    if (descuento.modoDescuento === 'Promocion' && descuento.info && descuento.estado) {
      if (descuento.info.modo === 'CODIGO') {
        const cupon = await Cupones.findOne({
          codigoCupon: descuento.info?.codigoCupon,
        }).session(session);

        if (cupon) {
          cupon.estado = false;
          cupon.dateUse.fecha = fechaActual;
          cupon.dateUse.hora = horaActual;
          await cupon.save({ session });
        }
      }
    }

    // 4. ADD PAGO

    let nuevoPago;
    if (infoPago) {
      nuevoPago = await handleAddPago(
        {
          ...infoPago,
          idOrden: facturaId,
        },
        session
      );
    }

    if (nuevoPago) {
      newPago = {
        ...nuevoPago,
        codRecibo: codRecibo,
        Nombre: Nombre,
        delivery: delivery,
      };
    }

    // 5. UPDATE FACTURA (ORDEN DE SERVICIO)
    const infoToUpdate = {
      infoRecepcion,
      Nombre,
      idCliente: idCli,
      Items,
      celular,
      direccion,
      datePrevista,
      descuento,
      estado: 'registrado',
      listPago: newPago ? [newPago._id] : [],
      dni,
      subTotal,
      totalNeto,
      cargosExtras,
      gift_promo,
    };

    const orderUpdated = await Factura.findByIdAndUpdate(
      facturaId,
      { $set: infoToUpdate },
      { new: true, session }
    ).lean();

    await session.commitTransaction();

    res.json({
      orderUpdated: {
        ...orderUpdated,
        ListPago: newPago ? [newPago] : [],
      },
      ...(newPago && { newPago }),
      ...(infoCliente && { changeCliente: infoCliente }),
    });
  } catch (error) {
    console.error('Error al actualizar los datos de la orden:', error);
    await session.abortTransaction();
    res.status(500).json({ mensaje: 'Error al actualizar los datos de la orden' });
  } finally {
    session.endSession();
  }
});

function actualizarDatosConModo(antes, despues) {
  let resultado = {
    puntos: [],
    promociones: [],
  };

  // Verificamos los cambios en `modoDescuento`
  if (antes.descuento.modoDescuento === 'Puntos' && despues.descuento.modoDescuento === 'Promocion') {
    resultado.puntos.push({
      _id: antes.idCliente,
      puntos: antes.descuento.info?.puntosUsados || 0,
    });
    resultado.promociones.push({
      estado: 'usar',
      codigo: despues.descuento.info.codigoCupon,
    });
    console.log(`Devolviendo puntos al cliente ${antes.idCliente} y usando cupón de promoción.`);
  } else if (antes.descuento.modoDescuento === 'Promocion' && despues.descuento.modoDescuento === 'Puntos') {
    resultado.promociones.push({
      estado: 'restablecer',
      codigo: antes.descuento.info.codigoCupon,
    });
    resultado.puntos.push({
      _id: despues.idCliente,
      puntos: -despues.descuento.info.puntosUsados || 0,
    });
    console.log(`Habilitando cupón anterior y descontando puntos del cliente ${despues.idCliente}.`);
  } else if (antes.descuento.modoDescuento === 'Puntos' && despues.descuento.modoDescuento === 'Ninguno') {
    resultado.puntos.push({
      _id: antes.idCliente,
      puntos: antes.descuento.info.puntosUsados || 0,
    });
    console.log(`Devolviendo puntos al cliente ${antes.idCliente} ya que ahora no hay descuento.`);
  } else if (antes.descuento.modoDescuento === 'Promocion' && despues.descuento.modoDescuento === 'Ninguno') {
    resultado.promociones.push({
      estado: 'restablecer',
      codigo: antes.descuento.info.codigoCupon,
    });
    console.log(`Cupón anterior habilitado ya que ahora no hay descuento.`);
  } else if (antes.descuento.modoDescuento === 'Ninguno' && despues.descuento.modoDescuento === 'Puntos') {
    resultado.puntos.push({
      _id: despues.idCliente,
      puntos: -despues.descuento.info.puntosUsados || 0,
    });
    console.log(`Descontando puntos del cliente ${despues.idCliente} ya que se agregó descuento de puntos.`);
  } else if (antes.descuento.modoDescuento === 'Ninguno' && despues.descuento.modoDescuento === 'Promocion') {
    resultado.promociones.push({
      estado: 'usar',
      codigo: despues.descuento.info.codigoCupon,
    });
    console.log(`Usando cupón de promoción ya que se agregó descuento de promoción.`);
  }

  // Validar cambios en `codigoCupon` si el `modoDescuento` sigue siendo `Promoción`
  if (antes.descuento.modoDescuento === 'Promocion' && despues.descuento.modoDescuento === 'Promocion') {
    if (antes.descuento.info.codigoCupon !== despues.descuento.info.codigoCupon) {
      resultado.promociones.push({
        estado: 'restablecer',
        codigo: antes.descuento.info.codigoCupon,
      });
      resultado.promociones.push({
        estado: 'usar',
        codigo: despues.descuento.info.codigoCupon,
      });
      console.log(`Restableciendo cupón anterior y usando nuevo cupón debido al cambio de código.`);
    }
  }

  // Ajustar puntos si hay un cambio en el valor de los puntos usados y en el cliente
  if (antes.descuento.modoDescuento === 'Puntos' && despues.descuento.modoDescuento === 'Puntos') {
    if (antes.idCliente !== despues.idCliente) {
      resultado.puntos.push({
        _id: antes.idCliente,
        puntos: antes.descuento.info.puntosUsados || 0,
      });
      resultado.puntos.push({
        _id: despues.idCliente,
        puntos: -despues.descuento.info.puntosUsados || 0,
      });
      console.log(
        `Cambio de cliente: devolviendo ${antes.descuento.info.puntosUsados} puntos al cliente anterior ${antes.idCliente} y descontando ${despues.descuento.info.puntosUsados} al nuevo cliente ${despues.idCliente}.`
      );
    } else {
      const diferenciaPuntos = (despues.descuento.info.puntosUsados || 0) - (antes.descuento.info.puntosUsados || 0);
      if (diferenciaPuntos > 0) {
        resultado.puntos.push({
          _id: antes.idCliente,
          puntos: -diferenciaPuntos,
        });
        console.log(`Restando ${diferenciaPuntos} puntos adicionales al cliente ${antes.idCliente}.`);
      } else if (diferenciaPuntos < 0) {
        resultado.puntos.push({
          _id: antes.idCliente,
          puntos: Math.abs(diferenciaPuntos),
        });
        console.log(`Devolviendo ${Math.abs(diferenciaPuntos)} puntos al cliente ${antes.idCliente}.`);
      }
    }
  }

  // Filtrar puntos y promociones nulos
  resultado.puntos = resultado.puntos.filter((p) => p._id && p.puntos !== 0);
  resultado.promociones = resultado.promociones.filter((p) => p.codigo);

  return resultado;
}

// ACTUALIZA INFORMACION DE ITEMS EN LA ORDEN (SOLO DETALLE), Nombre, direccion, numero, documento
router.put('/update-factura/simple-info/:id', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const facturaId = req.params.id;
    const {
      isNewCliente,
      delivery,
      idCliente,
      datePrevista,
      Nombre,
      direccion,
      celular,
      dni,
      Items,
      descuento,
      subTotal,
      totalNeto,
      lastEdit,
    } = req.body.infoOrden;

    let idClienteToUpdate = idCliente;

    // Info de orden antes de actualizar
    const currentOrderData = await Factura.findById(facturaId).session(session).select({
      codRecibo: 1,
      idCliente: 1,
      descuento: 1,
    });

    // Agregamos nuevo cliente si este se solicita
    if (!idClienteToUpdate && isNewCliente) {
      const nuevoCliente = new clientes({
        dni,
        nombre: Nombre,
        direccion,
        phone: celular,
        infoScore: [],
        scoreTotal: 0,
      });
      await nuevoCliente.save({ session });

      idClienteToUpdate = nuevoCliente._id.toString();
    }

    // Actualizar la información de la orden
    const updatedOrderData = await Factura.findByIdAndUpdate(
      facturaId,
      {
        $set: {
          delivery,
          idCliente: idClienteToUpdate,
          Nombre,
          direccion,
          datePrevista,
          celular,
          dni,
          Items,
          descuento,
          subTotal,
          totalNeto,
          lastEdit,
        },
      },
      {
        new: true,
        session,
        projection: {
          codRecibo: 1,
          delivery: 1,
          idCliente: 1,
          Nombre: 1,
          direccion: 1,
          datePrevista: 1,
          celular: 1,
          dni: 1,
          Items: 1,
          descuento: 1,
          subTotal: 1,
          totalNeto: 1,
        },
      }
    ).lean();

    const datos = actualizarDatosConModo(
      {
        idCliente: currentOrderData.idCliente,
        descuento: currentOrderData.descuento,
      },
      {
        idCliente: idClienteToUpdate,
        descuento,
      }
    );

    const { puntos, promociones } = datos; // Desestructurar los datos

    // Arreglo para las operaciones de bulkWrite
    const bulkCliente = [];
    const bulkCupones = [];

    // Procesar puntos
    puntos.forEach(({ _id, puntos }) => {
      bulkCliente.push({
        updateOne: {
          filter: { _id: _id },
          update: {
            $push: {
              infoScore: {
                puntos: Math.abs(puntos),
                tipoPuntaje: puntos > 0 ? 'positivo' : 'negativo',
                medioRegistro: 'directo',
                dateRegistro: currentDate(),
                info: {
                  motivo: `Se actualizó la orden ${currentOrderData.codRecibo}, ${
                    puntos > 0 ? 'Retorno de Puntos' : 'Uso de Puntos'
                  }`,
                },
              },
            },
            $inc: { scoreTotal: puntos },
          },
          session,
        },
      });
    });

    // Procesar promociones
    promociones.forEach(({ estado, codigo }) => {
      bulkCupones.push({
        updateOne: {
          filter: { codigoCupon: codigo },
          update: {
            $set: {
              estado: estado === 'usar' ? false : true,
              'dateUse.fecha': estado === 'usar' ? moment().format('YYYY-MM-DD') : '',
              'dateUse.hora': estado === 'usar' ? moment().format('HH:mm') : '',
            },
          },
          session,
        },
      });
    });

    // Ejecutar las operaciones bulk
    if (bulkCliente.length > 0) {
      await clientes.bulkWrite(bulkCliente, { session });
    }
    if (bulkCupones.length > 0) {
      await Cupones.bulkWrite(bulkCupones, { session });
    }

    const socketId = req.headers['x-socket-id'];
    emitToClients('server:updateOrder(SIMPLE)', updatedOrderData, socketId);

    await session.commitTransaction();
    res.json(updatedOrderData);
  } catch (error) {
    await session.abortTransaction();
    console.error('Error al actualizar los datos de la orden:', error);
    res.status(500).json({ mensaje: 'Error al actualizar los datos de la orden' });
  } finally {
    session.endSession();
  }
});

// ACTUALIZA ORDEN A ENTREGADO
router.put('/update-factura/entregar/:id', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const facturaId = req.params.id;
    const { location, infoEntrega } = req.body;

    let infoCliente;
    let newGasto;

    if (req.body.hasOwnProperty('infoGastoByDelivery')) {
      const { infoGastoByDelivery } = req.body;
      if (infoGastoByDelivery) {
        newGasto = await handleAddGasto(infoGastoByDelivery);
      }
    }

    const orderUpdated = await Factura.findByIdAndUpdate(
      facturaId,
      {
        $set: {
          stateLavado: 'ready',
          estadoPrenda: 'entregado',
          location: 1,
          infoEntrega: infoEntrega,
        },
      },
      {
        new: true,
        session,
        fields: {
          idCliente: 1,
          codRecibo: 1,
          infoEntrega: 1,
          totalNeto: 1,
          stateLavado: 1,
          estadoPrenda: 1,
          location: 1,
          infoRecepcion: 1,
        },
      } // Solo devuelve los campos necesarios
    ).lean();

    const stateUsePuntos = await checkPuntosState();

    if (orderUpdated.idCliente && stateUsePuntos) {
      try {
        const clienteActualizado = await clientes
          .findByIdAndUpdate(
            orderUpdated.idCliente,
            {
              $push: {
                infoScore: {
                  puntos: parseInt(orderUpdated.totalNeto),
                  tipoPuntaje: 'positivo',
                  medioRegistro: 'servicio',
                  dateRegistro: currentDate(),
                  info: {
                    idOrden: orderUpdated._id.toString(),
                    codigoOrden: orderUpdated.codRecibo,
                  },
                },
              },
              $inc: {
                scoreTotal: parseInt(orderUpdated.totalNeto),
              },
            },
            { new: true, session: session }
          )
          .lean();

        if (clienteActualizado) {
          infoCliente = {
            tipoAction: 'update',
            data: clienteActualizado,
          };
        } else {
          console.log('Cliente no encontrado.');
        }
      } catch (error) {
        console.error('Error al buscar o actualizar el cliente:', error);
        res.status(500).json({
          mensaje: 'Error al buscar o actualizar el cliente',
        });
      }
    }

    if (location === 2) {
      await Almacen.findOneAndDelete({ idOrden: facturaId }).session(session);
    }

    await session.commitTransaction();

    res.json({
      orderUpdated: {
        _id: orderUpdated._id,
        estadoPrenda: orderUpdated.estadoPrenda,
        location: orderUpdated.location,
        infoEntrega: orderUpdated.infoEntrega,
        stateLavado: orderUpdated.stateLavado,
      },
      ...(newGasto && { newGasto }),
      ...(infoCliente && { changeCliente: infoCliente }),
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error al Entregar Orden de Servicio:', error);
    res.status(500).json({ mensaje: 'Error al Entregar Orden de Servicio' });
  } finally {
    session.endSession();
  }
});

// ACTUALIZA ORDEN A CANCELAR ENTREGA
router.post('/update-factura/cancelar-entregar/:id', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction(); // Comienza una transacción

  try {
    const facturaId = req.params.id;

    let infoCliente;

    const orderUpdated = await Factura.findByIdAndUpdate(
      facturaId,
      {
        estadoPrenda: 'pendiente',
        infoEntrega: {
          tipo: '',
          id: '',
          fecha: null,
          responsable: '',
        },
      },
      {
        new: true,
        session: session,
        fields: {
          codRecibo: 1,
          idCliente: 1,
          estadoPrenda: 1,
          infoEntrega: 1,
          totalNeto: 1,
        },
      }
    );

    const stateUsePuntos = await checkPuntosState();

    if (orderUpdated.idCliente && stateUsePuntos) {
      try {
        // Buscar y actualizar el cliente si existe
        const clienteActualizado = await clientes
          .findByIdAndUpdate(
            orderUpdated.idCliente,
            {
              $inc: { scoreTotal: -parseInt(orderUpdated.totalNeto) },
              $push: {
                infoScore: {
                  puntos: parseInt(orderUpdated.totalNeto),
                  tipoPuntaje: 'negativo',
                  medioRegistro: 'directo',
                  dateRegistro: currentDate(),
                  info: {
                    motivo: `Se canceló la entrega de la orden ${orderUpdated.codRecibo}`,
                  },
                },
              },
            },
            { new: true } // Devuelve el documento actualizado
          )
          .lean();

        if (clienteActualizado) {
          infoCliente = {
            tipoAction: 'update',
            data: clienteActualizado,
          };
        } else {
          console.log('Cliente no encontrado.');
        }
      } catch (error) {
        console.error('Error al buscar o actualizar el cliente:', error);
        res.status(500).json({
          mensaje: 'Error al buscar o actualizar el cliente',
        });
      }
    }

    await session.commitTransaction();

    res.json({
      orderUpdated: {
        _id: orderUpdated._id,
        estadoPrenda: orderUpdated.estadoPrenda,
        infoEntrega: orderUpdated.infoEntrega,
      },
      ...(infoCliente && { changeCliente: infoCliente }),
    });
  } catch (error) {
    await session.abortTransaction();
    console.error(error);
    res.status(500).json({ mensaje: 'Error al cancelar Entrega' });
  } finally {
    session.endSession();
  }
});

// ACTUALIZA ORDEN ANULADO
router.put('/update-factura/anular/:id', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  try {
    const { id: facturaId } = req.params;
    const { infoAnulacion, pagosToDelete } = req.body;

    const pagosEliminados = [];

    for (const idPago of pagosToDelete) {
      const pagoEliminado = await Pagos.findByIdAndDelete(idPago, { session });

      if (pagoEliminado) {
        pagosEliminados.push(pagoEliminado._id);
      } else {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ mensaje: `Error: No se pudo eliminar el pago ${idPago} mientras se anulaba la factura` });
      }
    }

    const orderUpdated = await Factura.findByIdAndUpdate(
      facturaId,
      {
        estadoPrenda: 'anulado',
        stateLavado: 'cancelled',
        $pull: { listPago: { $in: pagosEliminados } },
      },
      {
        new: true,
        session: session,
        fields: {
          codRecibo: 1,
          estadoPrenda: 1,
          stateLavado: 1,
          listPago: 1,
          idCliente: 1,
          descuento: 1,
          Items: 1,
          modeRegistro: 1,
        },
      }
    );

    const itemsTipoProductos = orderUpdated.Items.filter((item) => item.tipo === 'producto');
    // Agrupar productos por identificador y sumar sus cantidades
    const infoProductos = Object.values(
      itemsTipoProductos.reduce((acc, item) => {
        if (!acc[item.identificador]) {
          acc[item.identificador] = { _id: item.identificador, stockPrincipal: 0 };
        }
        acc[item.identificador].stockPrincipal += item.cantidad;
        return acc;
      }, {})
    );

    let productosUpdated = [];

    if (infoProductos.length > 0 && orderUpdated.modeRegistro === 'nuevo') {
      // Obtener los identificadores de los productos agrupados
      const idsProductos = infoProductos.map((item) => item._id);

      // Consultar los productos en la base de datos
      const productos = await Producto.find({ _id: { $in: idsProductos } }, { _id: 1, stockPrincipal: 1 }).lean();
      const productosMap = mapObjectByKey(productos, '_id');

      // Preparar las operaciones bulk
      const bulkOperations = infoProductos
        .map((ipro) => {
          const producto = productosMap[ipro._id];

          if (producto && ipro.stockPrincipal > 0) {
            producto.stockPrincipal += ipro.stockPrincipal;
            return {
              updateOne: {
                filter: { _id: producto._id },
                update: { $inc: { stockPrincipal: ipro.stockPrincipal } },
                session,
              },
            };
          }
        })
        .filter(Boolean);

      if (bulkOperations.length > 0) {
        await Producto.bulkWrite(bulkOperations);
      }

      if (productos.length > 0) {
        // Devolver el array de objetos con _id y la cantidad restante
        productosUpdated = infoProductos.map((ipro) => ({
          _id: ipro._id,
          stockPrincipal: productosMap[ipro._id].stockPrincipal,
        }));

        const listNewsMovimientos = infoProductos
          .filter((ipro) => productosMap[ipro._id]) // Filtrar productos que existen
          .map((ipro) => {
            return {
              idProducto: ipro._id,
              accion: 'anulacion',
              cantidad: ipro.stockPrincipal,
              tipo: 'positivo',
              info: {
                idOrden: orderUpdated._id.toString(),
                codigoOrden: orderUpdated.codRecibo,
              },
            };
          });

        await MovimientoProducto.insertMany(listNewsMovimientos, { session });
      }
    }

    let infoCliente;
    // Eliminamos los Puntos usados
    if (
      orderUpdated.descuento.modoDescuento === 'Puntos' &&
      orderUpdated.descuento.info?.puntosUsados > 0 &&
      orderUpdated.descuento.estado
    ) {
      // Buscar y actualizar el cliente si existe
      const clienteActualizado = await clientes
        .findByIdAndUpdate(
          orderUpdated.idCliente,
          {
            $inc: { scoreTotal: orderUpdated.descuento.info.puntosUsados },
            $push: {
              infoScore: {
                puntos: orderUpdated.descuento.info.puntosUsados,
                tipoPuntaje: 'positivo',
                medioRegistro: 'directo',
                dateRegistro: currentDate(),
                info: {
                  motivo: `Se anulo la orden ${orderUpdated.codRecibo} , Retorno de Puntos`,
                },
              },
            },
          },
          { new: true }
        )
        .lean();

      if (clienteActualizado) {
        infoCliente = {
          tipoAction: 'update',
          data: clienteActualizado,
        };
      }
    }

    if (
      orderUpdated.descuento.modoDescuento === 'Promocion' &&
      orderUpdated.descuento.info &&
      orderUpdated.descuento.estado
    ) {
      if (orderUpdated.descuento.info.modo === 'CODIGO') {
        const cupon = await Cupones.findOne({
          codigoCupon: orderUpdated.descuento.info.codigoCupon,
        });
        if (cupon) {
          cupon.estado = true;
          cupon.dateUse.fecha = '';
          cupon.dateUse.hora = '';
          await cupon.save({ session });
        }
      }
    }

    const nuevaAnulacion = new Anular(infoAnulacion);
    await nuevaAnulacion.save({ session });

    await session.commitTransaction();

    const socketId = req.headers['x-socket-id'];
    pagosEliminados.map((idPagoDeleted) => {
      emitToClients('server:cPago', {
        tipo: 'deleted',
        info: {
          _id: idPagoDeleted,
          idOrden: facturaId,
        },
      });
    });
    productosUpdated.length > 0 && emitToClients('service:updatedProductos', productosUpdated);
    infoCliente && emitToClients('server:cClientes', infoCliente);

    const orderAnulado = {
      _id: orderUpdated._id,
      estadoPrenda: orderUpdated.estadoPrenda,
      stateLavado: orderUpdated.stateLavado,
      listPago: orderUpdated.listPago,
    };

    emitToClients('server:updateOrder(ANULACION)', orderAnulado, socketId);

    res.json(orderAnulado);
  } catch (error) {
    await session.abortTransaction();
    console.error(error);
    res.status(500).json({ mensaje: 'Error al ANULAR Orden de Servicio' });
  } finally {
    session.endSession();
  }
});

// ACTUALIZA ORDEN (NOTA)
router.put('/update-factura/nota/:id', async (req, res) => {
  try {
    const { id: facturaId } = req.params;
    const { infoNotas } = req.body;

    const orderUpdated = await Factura.findByIdAndUpdate(
      facturaId,
      { notas: infoNotas },
      { new: true, fields: { notas: 1 } }
    );

    if (!orderUpdated) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    res.json({
      _id: orderUpdated._id,
      notas: orderUpdated.notas,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al actualizar la nota de la factura' });
  }
});

// ANULAR Y REMPLAZAR ORDEN SERVICIO
router.post('/anular-to-replace', async (req, res) => {
  const session = await db.startSession();
  session.startTransaction();

  const { dataToNewOrden, dataToAnular, pagosToDelete, infoUser } = req.body;

  try {
    const { idOrden, infoAnulacion } = dataToAnular;

    const nuevaAnulacion = new Anular(infoAnulacion);
    await nuevaAnulacion.save({ session });

    const pagosEliminados = [];

    for (const idPago of pagosToDelete) {
      const pagoEliminado = await Pagos.findByIdAndDelete(idPago, { session });

      if (pagoEliminado) {
        pagosEliminados.push(pagoEliminado._id);
      } else {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ mensaje: `Error: No se pudo eliminar el pago ${idPago} mientras se anulaba la factura` });
      }
    }

    const orderAnulada = await Factura.findByIdAndUpdate(
      idOrden,
      {
        estadoPrenda: 'anulado',
        stateLavado: 'cancelled',
        $pull: { listPago: { $in: pagosEliminados } },
      },
      {
        new: true,
        session: session,
        fields: {
          codRecibo: 1,
          estadoPrenda: 1,
          stateLavado: 1,
          listPago: 1,
          idCliente: 1,
          descuento: 1,
          Items: 1,
          modeRegistro: 1,
        },
      }
    );

    const itemsTipoProductos = orderAnulada.Items.filter((item) => item.tipo === 'producto');
    // Agrupar productos por identificador y sumar sus cantidades
    const infoProductos = Object.values(
      itemsTipoProductos.reduce((acc, item) => {
        if (!acc[item.identificador]) {
          acc[item.identificador] = { _id: item.identificador, stockPrincipal: 0 };
        }
        acc[item.identificador].stockPrincipal += item.cantidad;
        return acc;
      }, {})
    );

    let productosUpdatedBase = [];

    if (infoProductos.length > 0 && orderAnulada.modeRegistro === 'nuevo') {
      // Obtener los identificadores de los productos agrupados
      const idsProductos = infoProductos.map((item) => item._id);

      // Consultar los productos en la base de datos
      const productos = await Producto.find({ _id: { $in: idsProductos } }, { _id: 1, stockPrincipal: 1 }).lean();
      const productosMap = mapObjectByKey(productos, '_id');

      // Preparar las operaciones bulk
      const bulkOperations = infoProductos
        .map((ipro) => {
          const producto = productosMap[ipro._id];

          if (producto && ipro.stockPrincipal > 0) {
            producto.stockPrincipal += ipro.stockPrincipal;
            return {
              updateOne: {
                filter: { _id: producto._id },
                update: { $inc: { stockPrincipal: ipro.stockPrincipal } },
                session,
              },
            };
          }
        })
        .filter(Boolean);

      if (bulkOperations.length > 0) {
        await Producto.bulkWrite(bulkOperations);
      }

      if (productos.length > 0) {
        // Devolver el array de objetos con _id y la cantidad restante
        productosUpdatedBase = infoProductos.map((ipro) => ({
          _id: ipro._id,
          stockPrincipal: productosMap[ipro._id].stockPrincipal,
        }));

        const listNewsMovimientos = infoProductos
          .filter((ipro) => productosMap[ipro._id]) // Filtrar productos que existen
          .map((ipro) => {
            return {
              idProducto: ipro._id,
              accion: 'anulacion',
              cantidad: ipro.stockPrincipal,
              tipo: 'positivo',
              info: {
                idOrden: orderAnulada._id.toString(),
                codigoOrden: orderAnulada.codRecibo,
              },
            };
          });

        await MovimientoProducto.insertMany(listNewsMovimientos, { session });
      }
    }

    let listChangeCliente = [];

    if (
      orderAnulada.descuento.modoDescuento === 'Puntos' &&
      orderAnulada.descuento.info?.puntosUsados > 0 &&
      orderAnulada.descuento.estado
    ) {
      // Buscar y actualizar el cliente si existe
      const clienteActualizado = await clientes
        .findByIdAndUpdate(
          orderAnulada.idCliente,
          {
            $inc: { scoreTotal: orderAnulada.descuento.info.puntosUsados },
            $push: {
              infoScore: {
                puntos: orderAnulada.descuento.info.puntosUsados,
                tipoPuntaje: 'positivo',
                medioRegistro: 'directo',
                dateRegistro: currentDate(),
                info: {
                  motivo: `Se anulo la orden ${orderAnulada.codRecibo} , Retorno de Puntos`,
                },
              },
            },
          },
          { new: true } // Devuelve el documento actualizado
        )
        .lean();

      if (clienteActualizado) {
        listChangeCliente.push({
          tipoAction: 'update',
          data: clienteActualizado,
        });
      } else {
        console.log('Cliente no encontrado.');
      }
    }
    if (
      orderAnulada.descuento.modoDescuento === 'Promocion' &&
      orderAnulada.descuento.info !== null &&
      orderAnulada.descuento.estado
    ) {
      if (orderAnulada.descuento.info.modo === 'CODIGO') {
        const cupon = await Cupones.findOne({
          codigoCupon: orderAnulada.descuento.info?.codigoCupon,
        }).session(session);

        if (cupon) {
          cupon.estado = true;
          cupon.dateUse.fecha = '';
          cupon.dateUse.hora = '';
          await cupon.save({ session });
        }
      }
    }

    const result = await handleAddFactura(dataToNewOrden, session);

    const { newOrder, newPago, newGasto, infoCliente, newCodigo, productosUpdated } = result;

    await session.commitTransaction();

    if (infoCliente) {
      listChangeCliente.push(infoCliente);
    }

    productosUpdatedBase = [...productosUpdatedBase, ...productosUpdated];

    pagosEliminados.map((idPagoDeleted) => {
      emitToClients('server:cPago', {
        tipo: 'deleted',
        info: {
          _id: idPagoDeleted,
          idOrden: idOrden,
        },
      });
    });

    const socketId = req.headers['x-socket-id'];

    productosUpdatedBase.length > 0 && emitToClients('service:updatedProductos', productosUpdatedBase);
    newPago &&
      emitToClients(
        'server:cPago',
        {
          tipo: 'added',
          info: {
            ...newPago,
            infoUser,
          },
        },
        socketId
      );
    newGasto && emitToClients('server:cGasto', newGasto);
    listChangeCliente.map((changeCliente) => {
      emitToClients('server:cClientes', changeCliente);
    });
    emitToClients('server:updateCodigo', newCodigo.codActual);

    emitToClients(
      'server:changeOrder',
      {
        tipo: 'add',
        info: {
          ...newOrder,
          ListPago: newOrder.ListPago.map((pago) => ({ ...pago, infoUser })),
        },
      },
      socketId
    );

    emitToClients('server:updateOrder(ANULACION)', {
      _id: orderAnulada._id,
      estadoPrenda: orderAnulada.estadoPrenda,
      stateLavado: orderAnulada.stateLavado,
      listPago: orderAnulada.listPago,
    });

    res.json({
      ...newOrder,
      ListPago: newOrder.ListPago.map((pago) => ({ ...pago, infoUser })),
    });
  } catch (error) {
    console.error('Error al guardar los datos:', error);
    await session.abortTransaction();

    res.status(500).json({ mensaje: error.message });
  } finally {
    session.endSession();
  }
});

router.get('/count-orders/:fecha', async (req, res) => {
  const { fecha } = req.params;

  try {
    // Parsear la fecha para obtener el mes y el año
    const parsedFecha = moment(fecha, 'YYYY-MM-DD');
    const mes = parsedFecha.month(); // Los meses en moment están indexados en 0
    const año = parsedFecha.year();

    // Crear los límites de tiempo para la consulta
    const startOfMonth = moment({ year: año, month: mes }).startOf('month').toDate();
    const endOfMonth = moment({ year: año, month: mes }).endOf('month').toDate();

    // Contar las facturas por delivery
    const tiendaCount = await Factura.countDocuments({
      dateCreation: { $gte: startOfMonth, $lte: endOfMonth },
      estadoPrenda: { $nin: ['anulado', 'donado'] },
      estado: 'registrado',
      delivery: false,
    });

    const deliveryCount = await Factura.countDocuments({
      dateCreation: { $gte: startOfMonth, $lte: endOfMonth },
      estadoPrenda: { $nin: ['anulado', 'donado'] },
      estado: 'registrado',
      delivery: true,
    });

    // Calcular el total
    const totalCount = tiendaCount + deliveryCount;

    // Responder con el conteo
    res.status(200).json({
      Tienda: tiendaCount,
      Delivery: deliveryCount,
      Total: totalCount,
    });
  } catch (error) {
    console.error('Error al contar documentos: ', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});
router.post('/facturas-by-cliente', async (req, res) => {
  const { idCliente, estadoPrenda } = req.body;

  if (!idCliente || !estadoPrenda) {
    return res.status(400).json({ mensaje: 'Debes proporcionar idCliente y estadoPrenda' });
  }

  try {
    const facturas = await Factura.find({ idCliente, estadoPrenda }).lean();
    let infoFormateada = [];

    if (facturas.length > 0) {
      infoFormateada = await handleGetInfoDetallada(facturas);
    }

    res.json(infoFormateada);
  } catch (error) {
    console.error('Error al buscar facturas:', error);
    res.status(500).json({ mensaje: 'Error al buscar facturas', error: error.message });
  }
});

router.post('/change-state-lavado/:idOrden/:newState', async (req, res) => {
  const { idOrden, newState } = req.params;

  if (newState !== 'inProgress' && newState !== 'ready') {
    return res.status(400).send({ message: 'Estado inválido' });
  }

  try {
    // Actualiza el estado de lavado directamente en la base de datos
    const updatedFactura = await Factura.findByIdAndUpdate(idOrden, { stateLavado: newState }, { new: true });

    const socketId = req.headers['x-socket-id'];
    emitToClients('server:updateOrder(ESTADO_LAVADO)', updatedFactura, socketId);

    if (!updatedFactura) {
      return res.status(404).send({ message: 'Orden de servicio no encontrada' });
    }

    res.status(200).send(updatedFactura);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Error al actualizar el estado de lavado', error });
  }
});

export default router;
