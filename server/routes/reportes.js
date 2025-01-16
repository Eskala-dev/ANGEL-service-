import express from 'express';
import Factura from '../models/Factura.js';
import Gasto from '../models/gastos.js';
import moment from 'moment';
import 'moment-timezone';
import Pagos from '../models/pagos.js';
import { mapArrayByKey, mapObjectByKey } from '../utils/utilsFuncion.js';
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

    // Consultar los pagos dentro del rango de fechas y con isCounted true
    const pagos = await Pagos.find({
      'date.fecha': {
        $gte: fechaInicial.format('YYYY-MM-DD'),
        $lte: fechaFinal.format('YYYY-MM-DD'),
      },
      isCounted: true,
    }).lean();

    // Consultar los gastos dentro del rango de fechas
    const gastos = await Gasto.find({
      'date.fecha': {
        $gte: fechaInicial.format('YYYY-MM-DD'),
        $lte: fechaFinal.format('YYYY-MM-DD'),
      },
    }).lean();

    // Obtener todos los métodos de pago únicos
    const metodosPagoUnicos = [
      ...new Set(
        pagos.map((pago) => pago.metodoPago).filter((metodo) => metodo !== 'Efectivo' && metodo !== 'Tarjeta')
      ),
    ];

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
          pagos: [
            {
              nombre: 'Efectivo',
              monto: 0,
            },
            {
              nombre: 'Tarjeta',
              monto: 0,
            },
            ...metodosPagoUnicos.map((metodo) => ({ nombre: metodo, monto: 0 })),
          ],
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
          pagos: [
            {
              nombre: 'Efectivo',
              monto: 0,
            },
            {
              nombre: 'Tarjeta',
              monto: 0,
            },
            ...metodosPagoUnicos.map((metodo) => ({ nombre: metodo, monto: 0 })),
          ],
          gastos: [...tiposGastosUnicos.map((tipo) => ({ nombre: tipo, monto: 0 }))],
          descuentos: [
            { nombre: 'Directo', monto: 0 },
            ...tipoDescuentoUnico.map((tipo) => ({ nombre: tipo, monto: 0 })),
          ],
        };
      }
      const metodoPago = reporte[fecha].pagos.find((p) => p.nombre === pago.metodoPago);
      if (metodoPago) {
        metodoPago.monto += pago.total;
      }
    });

    // Procesar gastos
    gastos.forEach((gasto) => {
      const fecha = gasto.date.fecha;
      if (!reporte[fecha]) {
        reporte[fecha] = {
          orden: [],
          portafolio: [],
          pagos: [
            {
              nombre: 'Efectivo',
              monto: 0,
            },
            {
              nombre: 'Tarjeta',
              monto: 0,
            },
            ...metodosPagoUnicos.map((metodo) => ({ nombre: metodo, monto: 0 })),
          ],
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

export default router;
