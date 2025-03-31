import express from 'express';
import Factura from '../models/Factura.js';
import Gasto from '../models/gastos.js';
import Negocio from '../models/negocio.js';
import moment from 'moment';
import 'moment-timezone';
import Pagos from '../models/pagos.js';
import { handleGetInfoDelivery, handleGetInfoOtros, mapArrayByKey, mapObjectByKey } from '../utils/utilsFuncion.js';
import Usuario from '../models/usuarios/usuarios.js';
import Producto from '../models/portafolio/productos/productos.js';
import Servicio from '../models/portafolio/servicios.js';
import Categoria from '../models/categorias.js';
import RolPersonal from '../models/personal/rolPersonal.js';
import Personal from '../models/personal/personal.js';

const router = express.Router();

router.get('/get-reporte-mensual', async (req, res) => {
  const { mes, anio } = req.query;

  // Validar que los parámetros mes y anio sean válidos
  if (!mes || !anio) {
    return res.status(400).json({ mensaje: 'Los parámetros mes y año son requeridos.' });
  }

  try {
    // Construir fechas de inicio y fin del mes
    const fechaInicial = moment(`${anio}-${mes}-01`, 'YYYY-MM');
    const fechaFinal = fechaInicial.clone().endOf('month');

    // Consultar las órdenes dentro del rango de fechas y estadoPrenda distinto de "anulado"
    const ordenes = await Factura.find({
      'infoRecepcion.fecha': {
        $gte: fechaInicial.toDate(),
        $lte: fechaFinal.toDate(),
      },
      estadoPrenda: { $ne: 'anulado' },
    }).lean();

    // Obtener los IDs de todos los pagos de las órdenes
    const idsPagos = ordenes.flatMap((orden) => orden.listPago);

    // Consultar todos los pagos de las órdenes
    const pagos = await Pagos.find({ _id: { $in: idsPagos } }).lean();

    // Crear un mapa array de pagos por ID de orden para un acceso más rápido
    const pagosPorOrden = mapArrayByKey(pagos, 'idOrden');

    // Combinar las órdenes con sus respectivos pagos
    const ordenesMensual = ordenes.map((orden) => ({
      ...orden,
      ListPago: pagosPorOrden[orden._id] || [],
    }));

    res.status(200).json(ordenesMensual);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'No se pudo generar el reporte EXCEL' });
  }
});

router.get('/get-reporte-pendientes', async (req, res) => {
  try {
    const facturas = await Factura.find({
      estadoPrenda: 'pendiente',
      estado: 'registrado',
      location: 1,
    }).lean();

    const listPagosIds = facturas.flatMap((factura) => factura.listPago);

    const pagos = await Pagos.find({
      _id: { $in: listPagosIds },
    }).lean();

    // Crear un mapa para agrupar los pagos por idOrden
    const pagosMap = mapArrayByKey(pagos, 'idOrden');

    // Obtener todos los idUser de los pagos sin repeticiones
    const idUsers = [...new Set(pagos.map((pago) => pago.idUser))];

    // Buscar la información de los usuarios relacionados con los idUsers
    const usuarios = await Usuario.find(
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

    // Mapear las facturas con sus pagos correspondientes
    const facturasPendientes = facturas.map((factura) => {
      const ListPago = (pagosMap[factura._id] || []).map((pago) => ({
        _id: pago._id,
        idUser: pago.idUser,
        idOrden: pago.idOrden,
        orden: factura.codRecibo,
        date: pago.date,
        nombre: factura.Nombre,
        total: pago.total,
        metodoPago: pago.metodoPago,
        delivery: factura.delivery,
        isCounted: pago.isCounted,
        infoUser: usuariosMap[pago.idUser],
      }));
      return { ...factura, ListPago };
    });
    res.json(facturasPendientes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'No se pudo obtener lista de ordenes pendientes' });
  }
});

router.get('/get-reporte-responsables', async (req, res) => {
  const { mes, anio } = req.query;

  // Validar que los parámetros mes y anio sean válidos
  if (!mes || !anio) {
    return res.status(400).json({ mensaje: 'Los parámetros mes y año son requeridos.' });
  }

  try {
    // Construir fechas de inicio y fin del mes
    const fechaInicial = moment(`${anio}-${mes}-01`, 'YYYY-MM');
    const fechaFinal = fechaInicial.clone().endOf('month');

    // Consultamos las facturas
    const facturas = await Factura.find({
      'infoRecepcion.fecha': {
        $gte: fechaInicial.toDate(),
        $lte: fechaFinal.toDate(),
      },
    }).lean();

    const rolesPersonal = await RolPersonal.find().lean();
    const personales = await Personal.find().lean();
    const usuarios = await Usuario.find().lean();

    const rolesPersonalMap = mapObjectByKey(rolesPersonal, '_id');
    const personalesMap = mapObjectByKey(personales, '_id');
    const usuariosMap = mapObjectByKey(usuarios, '_id');

    const responsables = facturas.flatMap((factura) => {
      const responsables = [];

      // Verificamos si existen responsables en infoRecepcion
      if (factura.infoRecepcion && factura.infoRecepcion.responsable) {
        responsables.push({
          responsable: factura.infoRecepcion.responsable,
          tipo: 'recepcion',
          codRecibo: factura.codRecibo,
          totalNeto: factura.totalNeto,
          estadoPrenda: factura.estadoPrenda,
          delivery: factura.delivery,
          rolesResponsable:
            factura.infoRecepcion.tipo === 'usuario'
              ? usuariosMap[factura.infoRecepcion.id]?.name
              : rolesPersonalMap[personalesMap[factura.infoRecepcion.id]?.idRolPersonal]?.nombre || 'rol eliminado',
        });
      }

      // Verificamos si existen responsables en infoEntrega
      if (factura.infoEntrega && factura.infoEntrega.id) {
        responsables.push({
          responsable: factura.infoEntrega.responsable,
          tipo: 'entrega',
          codRecibo: factura.codRecibo,
          totalNeto: factura.totalNeto,
          estadoPrenda: factura.estadoPrenda,
          delivery: factura.delivery,
          rolesResponsable:
            factura.infoEntrega.tipo === 'usuario'
              ? usuariosMap[factura.infoEntrega.id]?.name
              : rolesPersonalMap[personalesMap[factura.infoEntrega.id]?.idRolPersonal]?.nombre || 'rol eliminado',
        });
      }

      return responsables;
    });

    res.status(200).json(responsables);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener los responsables de las facturas' });
  }
});

router.get('/get-reporte-mensual-detallado', async (req, res) => {
  const { fecha } = req.query;

  if (!fecha) {
    return res.status(400).json({ mensaje: 'La fecha es requerida.' });
  }

  try {
    // Construir fechas de inicio y fin del mes
    const fechaInicial = moment(fecha, 'YYYY-MM-DD').startOf('month');
    const fechaFinal = moment(fecha, 'YYYY-MM-DD').endOf('month');

    // Consultar las facturas dentro del rango de fechas y estadoPrenda distinto de "anulado"
    const facturas = await Factura.find({
      'infoRecepcion.fecha': {
        $gte: fechaInicial.toDate(),
        $lte: fechaFinal.toDate(),
      },
      estadoPrenda: { $ne: 'anulado' },
    }).lean();

    const idsFacturasAntiguas = new Set(
      facturas.filter((factura) => factura.modeRegistro === 'antiguo').map((factura) => factura._id.toString())
    );

    // Consultar los pagos dentro del rango de fechas y con isCounted true
    const pagos = await Pagos.find({
      'date.fecha': {
        $gte: fechaInicial.format('YYYY-MM-DD'),
        $lte: fechaFinal.format('YYYY-MM-DD'),
      },
      //   isCounted: true,
    }).lean();

    // Consultar los gastos dentro del rango de fechas
    const gastos = await Gasto.find({
      'date.fecha': {
        $gte: fechaInicial.format('YYYY-MM-DD'),
        $lte: fechaFinal.format('YYYY-MM-DD'),
      },
    }).lean();

    const facturasIds = new Set(facturas.map((factura) => factura._id.toString()));

    // Obtener tipos de gastos únicos
    const tiposGastosUnicos = [...new Set(gastos.map((gasto) => gasto.tipo))];

    // Obtener todos los identificadores de items de las facturas
    const items = facturas.flatMap((factura) => factura.Items);
    const idsProductos = items.filter((item) => item.tipo === 'producto').map((item) => item.identificador);
    const idsServicios = items.filter((item) => item.tipo === 'servicio').map((item) => item.identificador);

    // Consultar la información de Producto y Servicio para esos identificadores
    const productos = await Producto.find({ _id: { $in: idsProductos } }).lean();
    const servicios = await Servicio.find({ _id: { $in: idsServicios } }).lean();

    // Crear un mapa de productos y servicios por identificador
    const productosMap = productos.reduce((acc, producto) => {
      acc[producto._id] = producto;
      return acc;
    }, {});

    const serviciosMap = servicios.reduce((acc, servicio) => {
      acc[servicio._id] = servicio;
      return acc;
    }, {});

    // Obtener todos los ids de categoría únicos
    const idsCategorias = [
      ...new Set([
        ...productos.map((producto) => producto.idCategoria),
        ...servicios.map((servicio) => servicio.idCategoria),
      ]),
    ];

    // Consultar la información de Categoria para esos IDs
    const categorias = await Categoria.find({ _id: { $in: idsCategorias } }).lean();
    const categoriasMap = categorias.reduce((acc, categoria) => {
      acc[categoria._id] = categoria.name;
      return acc;
    }, {});

    // Mantener un conjunto de todos los items únicos que aparecen en el portafolio
    const itemsPortafolio = new Set();

    // Mapear los datos por fecha
    const reporte = {};

    const tipoDescuentoUnico = [
      ...new Set(
        facturas.filter((factura) => factura.descuento?.estado).map((factura) => factura.descuento.modoDescuento)
      ),
    ];

    // Procesar facturas
    facturas.forEach((factura) => {
      const fecha = moment(factura.infoRecepcion.fecha).format('YYYY-MM-DD');
      if (!reporte[fecha]) {
        reporte[fecha] = {
          orden: [],
          portafolio: [],
          pagos: [],
          gastos: [...tiposGastosUnicos.map((tipo) => ({ nombre: tipo, monto: 0 }))],
          descuentos: [
            { nombre: 'Directo', monto: 0 },
            ...tipoDescuentoUnico.map((tipo) => ({ nombre: tipo, monto: 0 })),
          ],
        };
      }

      const descuento = reporte[fecha].descuentos.find((d) => d.nombre === factura.descuento.modoDescuento);

      if (descuento) {
        descuento.monto += factura.descuento.monto;
      }

      const montoDescuentoDirecto = factura.Items.map((item) => Number(item.descuentoManual)).reduce(
        (acc, curr) => acc + curr,
        0
      );

      const descuentoDirecto = reporte[fecha].descuentos.find((d) => d.nombre === 'Directo');
      if (descuentoDirecto) {
        descuentoDirecto.monto += montoDescuentoDirecto;
      }

      reporte[fecha].orden.push({
        _id: factura._id,
        subTotal: +factura.subTotal,
        totalNeto: +factura.totalNeto,
      });

      // Procesar items de la factura
      factura.Items.forEach((item) => {
        let nombre = null;
        let idCategoria = null;
        let simboloMedida = null;
        let nombreCategoria = null;

        if (item.tipo === 'producto' && productosMap[item.identificador]) {
          nombre = productosMap[item.identificador].nombre;
          simboloMedida = productosMap[item.identificador].simboloMedida;
          idCategoria = productosMap[item.identificador].idCategoria;
          nombreCategoria = categoriasMap[idCategoria];
        } else if (item.tipo === 'servicio' && serviciosMap[item.identificador]) {
          nombre = serviciosMap[item.identificador].nombre;
          simboloMedida = serviciosMap[item.identificador].simboloMedida;
          idCategoria = serviciosMap[item.identificador].idCategoria;
          nombreCategoria = categoriasMap[idCategoria];
        }

        const idDesconocido = 'SD001';
        if (nombre && idCategoria && nombreCategoria) {
          const existingItem = reporte[fecha].portafolio.find((i) => i._id === item.identificador);
          if (existingItem) {
            existingItem.cantidad += +item.cantidad;
            existingItem.total += +item.total;
          } else {
            reporte[fecha].portafolio.push({
              _id: item.identificador,
              simboloMedida: simboloMedida,
              nombreServicio: nombre,
              cantidad: +item.cantidad,
              total: +item.total,
              idCategoria: idCategoria,
              nombreCategoria: nombreCategoria,
              tipo: item.tipo,
            });
          }
        } else {
          const existingItem = reporte[fecha].portafolio.find((i) => i._id === idDesconocido);

          if (existingItem) {
            existingItem.cantidad += item.cantidad;
            existingItem.total += +item.total;
          } else {
            reporte[fecha].portafolio.push({
              _id: idDesconocido,
              simboloMedida: 'u',
              nombreServicio: 'ELIMINADO',
              cantidad: +item.cantidad,
              total: +item.total,
              idCategoria: 'CD001',
              nombreCategoria: 'DELETED',
              tipo: item.tipo,
            });
          }
        }

        // Agregar los items únicos al conjunto
        if (nombre && idCategoria && nombreCategoria) {
          itemsPortafolio.add(
            JSON.stringify({
              _id: item.identificador,
              nombreServicio: nombre,
              simboloMedida: simboloMedida,
              cantidad: 0,
              total: 0,
              idCategoria: idCategoria,
              nombreCategoria: nombreCategoria,
              tipo: item.tipo,
            })
          );
        }
      });
    });

    // Procesar pagos
    pagos.forEach((pago) => {
      const fecha = pago.date.fecha;

      if (!reporte[fecha]) {
        reporte[fecha] = {
          orden: [],
          portafolio: [],
          pagos: [],
          gastos: [...tiposGastosUnicos.map((tipo) => ({ nombre: tipo, monto: 0 }))],
          descuentos: [
            { nombre: 'Directo', monto: 0 },
            ...tipoDescuentoUnico.map((tipo) => ({ nombre: tipo, monto: 0 })),
          ],
        };
      }

      if (idsFacturasAntiguas.has(pago.idOrden) && !pago.isCounted && pago.metodoPago !== 'Exonerar') {
      } else {
        reporte[fecha].pagos.push({
          metodoPago: pago.metodoPago,
          total: pago.total,
          _id: pago._id,
          isThisMonth: facturasIds.has(pago.idOrden),
          isCounted: pago.isCounted,
        });
      }
    });

    // Procesar gastos
    gastos.forEach((gasto) => {
      const fecha = gasto.date.fecha;
      if (!reporte[fecha]) {
        reporte[fecha] = {
          orden: [],
          portafolio: [],
          pagos: [],
          pagos: [],
          gastos: [...tiposGastosUnicos.map((tipo) => ({ nombre: tipo, monto: 0 }))],
          descuentos: [
            { nombre: 'descuentoManual', monto: 0 },
            ...tipoDescuentoUnico.map((tipo) => ({ nombre: tipo, monto: 0 })),
          ],
        };
      }

      const tipoGasto = reporte[fecha].gastos.find((g) => g.nombre === gasto.tipo);
      if (tipoGasto) {
        tipoGasto.monto += +gasto.monto;
      }
    });

    // Asegurarse de que cada fecha tenga los mismos items en el portafolio
    const uniqueItems = Array.from(itemsPortafolio).map((item) => JSON.parse(item));
    Object.values(reporte).forEach((dia) => {
      uniqueItems.forEach((uniqueItem) => {
        if (!dia.portafolio.some((item) => item._id === uniqueItem._id)) {
          dia.portafolio.push({
            ...uniqueItem,
            total: 0,
            cantidad: 0,
          });
        }
      });
    });

    res.status(200).json(reporte);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'No se pudo generar el reporte mensual detallado' });
  }
});

router.get('/get-reporte-items/by-descuento', async (req, res) => {
  const { mes, anio } = req.query;

  // Validar que los parámetros sean números y estén dentro de un rango lógico
  if (!mes || !anio || isNaN(mes) || isNaN(anio) || mes < 1 || mes > 12) {
    return res.status(400).json({ mensaje: 'Los parámetros mes y año son requeridos y deben ser válidos.' });
  }

  try {
    // Construir fechas de inicio y fin del mes
    const fechaInicial = moment(`${anio}-${mes}-01`, 'YYYY-MM').startOf('month').toDate();
    const fechaFinal = moment(`${anio}-${mes}-01`, 'YYYY-MM').endOf('month').toDate();

    // Obtener infoOtros para excluir un identificador específico
    const infoOtros = await handleGetInfoOtros();

    // Consultar facturas dentro del rango de fechas con estado válido
    const ordenes = await Factura.find(
      {
        'infoRecepcion.fecha': { $gte: fechaInicial, $lte: fechaFinal },
        estadoPrenda: { $ne: 'anulado' },
        // 'Items.identificador': { $ne: infoOtros._id.toString() },
        Items: { $elemMatch: { descuentoManual: { $gt: 0 } } },
      },
      {
        codRecibo: 1,
        Nombre: 1,
        infoRecepcion: 1,
        'Items.item': 1,
        'Items.tipo': 1,
        'Items.cantidad': 1,
        'Items.precioBase': 1,
        'Items.precioCobrado': 1,
        'Items.descuentoManual': 1,
        'Items.total': 1,
      }
    ).lean();

    const reporteItems = ordenes.flatMap((orden) =>
      orden.Items.filter((item) => item.descuentoManual > 0).map((item) => ({
        _id: orden._id,
        codRecibo: orden.codRecibo,
        Nombre: orden.Nombre,
        item: item.item,
        tipo: item.tipo,
        cantidad: parseFloat(Number(item.cantidad).toFixed(2)),
        precioBase: parseFloat(Number(item.precioBase).toFixed(2)),
        precioCobrado: parseFloat(Number(item.precioCobrado).toFixed(2)),
        descuentoManual: parseFloat(Number(item.descuentoManual).toFixed(2)),
        total: parseFloat(Number(item.total).toFixed(2)),
        responsable: orden.infoRecepcion.responsable,
        fechaRecepcion: orden.infoRecepcion.fecha,
      }))
    );

    res.json(reporteItems);
  } catch (error) {
    console.error('Error al obtener el reporte:', error);
    res.status(500).json({ mensaje: 'Error al obtener el reporte de items' });
  }
});

router.get('/get-reporte-pagos/by-orden', async (req, res) => {
  const { mes, anio } = req.query;

  if (!mes || !anio || isNaN(mes) || isNaN(anio) || mes < 1 || mes > 12) {
    return res.status(400).json({ mensaje: 'Los parámetros mes y año son requeridos y deben ser válidos.' });
  }

  try {
    const fechaInicial = moment(`${anio}-${mes}-01`, 'YYYY-MM').startOf('month').toDate();
    const fechaFinal = moment(`${anio}-${mes}-01`, 'YYYY-MM').endOf('month').toDate();

    // Obtener facturas dentro del rango de fechas
    const ordenes = await Factura.find(
      {
        'infoRecepcion.fecha': { $gte: fechaInicial, $lte: fechaFinal },
        estadoPrenda: { $ne: 'anulado' },
        listPago: { $exists: true, $ne: [] },
      },
      {
        codRecibo: 1,
        Nombre: 1,
        infoRecepcion: 1,
        modeRegistro: 1,
        listPago: 1,
      }
    ).lean();

    if (ordenes.length === 0) {
      return res.json([]);
    }

    // Extraer y unificar los IDs de pagos
    const idsPagos = [...new Set(ordenes.flatMap((orden) => orden.listPago))];

    if (idsPagos.length === 0) {
      return res.json([]);
    }

    // Consultar todos los pagos
    const pagos = await Pagos.find({ _id: { $in: idsPagos } }).lean();

    // Extraer y unificar los IDs de usuario responsable del pago
    const idsResponsablePagos = [...new Set(pagos.flatMap((pago) => pago.idUser))];

    // Consultar todos los usuarios
    const usuarios = await Usuario.find({ _id: { $in: idsResponsablePagos } }).lean();

    // Mapeo de Pagos por Orden
    const mapPagosByOrden = mapArrayByKey(pagos, 'idOrden');

    // Mapeo de Pagos por Orden
    const mapUsuarios = mapObjectByKey(usuarios, '_id');

    // 5️⃣ Mapear cada factura con sus pagos asociados
    const reportePagos = ordenes.flatMap((orden) => {
      return (mapPagosByOrden[orden._id.toString()] || []).map((pago) => ({
        _id: orden._id,
        codRecibo: orden.codRecibo,
        Nombre: orden.Nombre,
        fechaRecepcion: orden.infoRecepcion.fecha,
        responsableOrden: orden.infoRecepcion.responsable,
        metodoPago: pago.metodoPago,
        totalPago: parseFloat(pago.total.toFixed(2)),
        fechaPago: pago.date.fecha,
        horaPago: pago.date.hora,
        responsablePago: mapUsuarios[pago.idUser].name || 'NO INFORMACION',
        detalle: pago.detail,
        modeRegistro: orden.modeRegistro,
      }));
    });

    res.json(reportePagos);
  } catch (error) {
    console.error('Error al obtener el reporte de pagos:', error);
    res.status(500).json({ mensaje: 'Error al obtener el reporte de pagos' });
  }
});

const generateDateArray = (type, filter) => {
  let fechas = [];

  if (type === 'daily') {
    const { days } = filter;
    // Generar fechas para los próximos 3 días
    fechas = Array.from({ length: days }, (_, index) =>
      moment().startOf('day').add(index, 'days').format('YYYY-MM-DD')
    );
    return fechas;
  } else {
    if (type === 'monthly') {
      const { date } = filter;
      // Generar fechas para todo el mes
      const firstDayOfMonth = moment(date).startOf('month');
      const lastDayOfMonth = moment(date).endOf('month');

      let currentDate = moment(firstDayOfMonth);
      while (currentDate <= lastDayOfMonth) {
        fechas.push(currentDate.format('YYYY-MM-DD'));
        currentDate.add(1, 'day');
      }
      return fechas;
    }
  }
};

router.get('/get-report/date-prevista/:startDate/:endDate', async (req, res) => {
  try {
    const { startDate, endDate } = req.params;

    // Validar formato de fecha con moment
    if (!moment(startDate, 'YYYY-MM-DD', true).isValid() || !moment(endDate, 'YYYY-MM-DD', true).isValid()) {
      return res.status(400).json({ mensaje: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }

    const fechaInicio = moment(startDate, 'YYYY-MM-DD').startOf('day').toDate();
    const fechaFin = moment(endDate, 'YYYY-MM-DD').endOf('day').toDate();

    const infoReporte = [];

    // Obtener información del negocio
    const infoNegocio = await Negocio.findOne();
    const itemsReporte = [...infoNegocio.itemsInformeDiario];

    // Agregar servicio de delivery
    const infoDelivery = await handleGetInfoDelivery();
    itemsReporte.push({
      order: itemsReporte.length,
      id: `SER${infoDelivery._id.toString()}`,
    });

    const splitItem = itemsReporte.map((item) => ({
      ID: item.id.substring(3),
      TIPO: item.id.substring(0, 3),
    }));

    let groupedResults = [];

    for (const item of splitItem) {
      let resultObject = { idColumna: item.ID };
      if (item.TIPO === 'CAT') {
        const servicios = await Servicio.find({ idCategoria: item.ID }, '_id');
        const productos = await Producto.find({ idCategoria: item.ID }, '_id');

        resultObject.idsCantidades = [
          ...servicios.map((s) => s._id.toString()),
          ...productos.map((p) => p._id.toString()),
        ];
      } else {
        resultObject.idsCantidades = [item.ID];
      }
      groupedResults.push(resultObject);
    }

    // Obtener facturas dentro del rango de fechas
    const facturas = await Factura.find({
      datePrevista: { $gte: fechaInicio, $lte: fechaFin },
      estadoPrenda: { $nin: ['anulado', 'donado'] },
    }).lean();

    // Agrupar facturas por fecha prevista
    const facturasPorFecha = facturas.reduce((acc, factura) => {
      const fechaPrevista = moment(factura.datePrevista).format('YYYY-MM-DD');
      acc[fechaPrevista] = acc[fechaPrevista] || [];
      acc[fechaPrevista].push(factura);
      return acc;
    }, {});

    // Construcción del informe
    Object.entries(facturasPorFecha).forEach(([fechaPrevista, facturasDelDia]) => {
      const resultado = {
        FechaPrevista: fechaPrevista,
        CantidadPedido: facturasDelDia.length,
        InfoItems: {},
        Facturas: facturasDelDia.map(
          ({ _id, codRecibo, Nombre, Items, totalNeto, infoRecepcion, datePrevista, estadoPrenda }) => ({
            _id,
            codRecibo,
            Nombre,
            Items,
            totalNeto,
            infoRecepcion,
            estadoPrenda,
            datePrevista,
          })
        ),
      };

      // Calcular cantidad por identificador
      facturasDelDia.forEach(({ Items }) => {
        Items.forEach(({ identificador, cantidad }) => {
          groupedResults.forEach(({ idColumna, idsCantidades }) => {
            if (idsCantidades.includes(identificador)) {
              resultado.InfoItems[idColumna] = (
                parseFloat(resultado.InfoItems[idColumna] || 0) + Number(cantidad)
              ).toFixed(2);
            }
          });
        });
      });

      // Convertir InfoItems en array
      resultado.InfoItems = Object.entries(resultado.InfoItems).map(([identificador, Cantidad]) => ({
        identificador,
        Cantidad,
      }));

      // Asegurar que todos los identificadores existan en InfoItems
      groupedResults.forEach(({ idColumna }) => {
        if (!resultado.InfoItems.find((item) => item.identificador === idColumna)) {
          resultado.InfoItems.push({ identificador: idColumna, Cantidad: 0 });
        }
      });

      infoReporte.push(resultado);
    });

    // Ordenar el informe por FechaPrevista (de menor a mayor)
    infoReporte.sort((a, b) => moment(a.FechaPrevista).unix() - moment(b.FechaPrevista).unix());

    res.json(infoReporte);
  } catch (error) {
    console.error('Error al obtener los datos:', error);
    res.status(500).json({ mensaje: 'Error al obtener los datos' });
  }
});

export default router;
