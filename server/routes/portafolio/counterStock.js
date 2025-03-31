import express from 'express';
import moment from 'moment';
import MovimientoProducto from '../../models/portafolio/productos/movimientosProducto.js';
import MovimientoInsumo from '../../models/portafolio/insumos/movimientosInsumo.js';

import Producto from '../../models/portafolio/productos/productos.js';
import Insumo from '../../models/portafolio/insumos/insumos.js';
import CounterStock from '../../models/portafolio/counterStock.js';
import { mapObjectByKey } from '../../utils/utilsFuncion.js';

const router = express.Router();

// Función auxiliar para obtener la lista de movimientos por Articulo en un rango de fechas
async function getMovementsByArticuloList(Model, idField, idArticulo, dateField, startMoment, endMoment) {
  return await Model.find({
    [idField]: idArticulo,
    [dateField]: {
      $gte: startMoment.format(),
      $lte: endMoment.format(),
    },
  }).lean();
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => acc && acc[key], obj);
}

router.get('/movimientos-rango', async (req, res) => {
  try {
    const { fechaInicio, fechaFin, idArticulo, categoria } = req.query;
    if (!fechaInicio || !fechaFin || !idArticulo || !categoria) {
      return res.status(400).json({
        error: 'Faltan parámetros requeridos: fechaInicio, fechaFin, idArticulo y categoria',
      });
    }

    // Convertir fechas usando moment (formato 'YYYY-MM-DD')
    const reqStart = moment(fechaInicio, 'YYYY-MM-DD').startOf('day');
    const reqEnd = moment(fechaFin, 'YYYY-MM-DD').set({
      hour: moment().hour(),
      minute: moment().minute(),
      second: moment().second(),
    });

    let Model, dateField, idField;
    if (categoria === 'producto') {
      Model = MovimientoProducto;
      dateField = 'dateRegistro';
      idField = 'idProducto';
    } else if (categoria === 'insumo') {
      Model = MovimientoInsumo;
      dateField = 'infoRegistro.fecha';
      idField = 'idInsumo';
    } else {
      return res.status(400).json({ error: 'La categoría debe ser "producto" o "insumo"' });
    }

    // Variables finales a retornar
    let stockAnterior = 0;
    let stockRangeDates = 0;
    let listMovimientos = [];
    // Baseline para recalcular en caso de no tener registro previo
    const baseline = moment('1900-01-01', 'YYYY-MM-DD');

    // Consultar registro previo en CounterStock
    const previousCounter = await CounterStock.findOne({ idArticulo, tipo: categoria })
      .sort({ lastCountDate: -1 })
      .lean();

    if (previousCounter) {
      const prevDate = moment(previousCounter.lastCountDate);
      const prevStock = previousCounter.stock;

      // Caso 3: Rango solicitado completamente posterior al último contador
      if (reqStart.isAfter(prevDate)) {
        let stockFaltante = 0;
        const infoMovimientos = await getMovementsByArticuloList(
          Model,
          idField,
          idArticulo,
          dateField,
          prevDate,
          reqEnd
        );
        listMovimientos = infoMovimientos.filter((mov) => {
          const movDate = moment(getNestedValue(mov, dateField));
          return movDate.isBetween(reqStart, reqEnd, null, '[]');
        });

        // Separamos los movimientos en función de la fecha
        infoMovimientos.forEach((mov) => {
          const movDate = moment(getNestedValue(mov, dateField));

          if (movDate.isBetween(prevDate, reqStart.clone().subtract(1, 'days'), null, '[]')) {
            stockFaltante += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
          } else {
            stockRangeDates += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
          }
        });

        stockAnterior = prevStock + stockFaltante;

        // Actualizar CounterStock con la suma de lo anterior y el rango
        await CounterStock.findOneAndUpdate(
          { _id: previousCounter._id },
          { lastCountDate: reqEnd.format(), stock: stockAnterior + stockRangeDates }
        );
      }
      // Caso 1: El rango solicitado se extiende antes y después del último contador
      else if (reqStart.isSameOrBefore(prevDate) && reqEnd.isAfter(prevDate)) {
        const infoMovimientos = await getMovementsByArticuloList(
          Model,
          idField,
          idArticulo,
          dateField,
          reqStart,
          reqEnd
        );
        listMovimientos = infoMovimientos;
        stockRangeDates = listMovimientos.reduce(
          (total, mov) => (mov.tipo === 'positivo' ? total + mov.cantidad : total - mov.cantidad),
          0
        );

        let diferencial = 0;

        // Separamos los movimientos en función de la fecha
        infoMovimientos.forEach((mov) => {
          const movDate = moment(getNestedValue(mov, dateField));

          // Movimientos después de reqEnd
          if (movDate.isBetween(reqStart, prevDate, null, '[]')) {
            diferencial += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
          }
        });

        stockAnterior = prevStock - diferencial;

        // Actualizar CounterStock con la suma de lo anterior y el rango
        await CounterStock.findOneAndUpdate(
          { _id: previousCounter._id },
          { lastCountDate: reqEnd.format(), stock: stockAnterior + stockRangeDates }
        );
      }
      // Caso 2: El rango solicitado está completamente dentro de lo ya contado (reqEnd <= prevDate)
      else if (reqEnd.isSameOrBefore(prevDate)) {
        // Obtenemos los movimientos entre reqStart y prevDate
        const infoMovimientos = await getMovementsByArticuloList(
          Model,
          idField,
          idArticulo,
          dateField,
          reqStart,
          prevDate
        );

        // Filtramos para obtener solo los movimientos en el rango [reqStart, reqEnd]
        listMovimientos = infoMovimientos.filter((mov) => {
          const movDate = moment(getNestedValue(mov, dateField));
          return movDate.isBetween(reqStart, reqEnd, null, '[]');
        });

        // Inicializamos los acumuladores
        let stockDespues = 0;

        // Separamos los movimientos en función de la fecha
        infoMovimientos.forEach((mov) => {
          const movDate = moment(getNestedValue(mov, dateField));
          // Movimientos después de reqEnd
          if (movDate.isAfter(reqEnd)) {
            stockDespues += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
          } else if (movDate.isBetween(reqStart, reqEnd, null, '[]')) {
            // Movimientos entre reqStart y reqEnd (inclusive)
            stockRangeDates += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
          }
        });

        // Se asume que prevStock es el stock previamente registrado hasta reqStart
        stockAnterior = prevStock - (stockRangeDates + stockDespues);
      }
    } else {
      // Caso 4: No existe registro previo en CounterStock
      const infoMovimientos = await getMovementsByArticuloList(Model, idField, idArticulo, dateField, baseline, reqEnd);
      // Filtramos para obtener solo los movimientos en el rango reqStart y reqEnd (inclusive)
      listMovimientos = infoMovimientos.filter((mov) => {
        const movDate = moment(getNestedValue(mov, dateField));
        return movDate.isBetween(reqStart, reqEnd, null, '[]');
      });

      // Separamos los movimientos en función de la fecha
      infoMovimientos.forEach((mov) => {
        const movDate = moment(getNestedValue(mov, dateField));
        if (movDate.isBefore(reqStart)) {
          // Movimientos anteriores a reqStart
          stockAnterior += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
        } else {
          // Movimientos entre reqStart y reqEnd (incluyendo reqStart)
          stockRangeDates += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
        }
      });

      // Busca si existe si no Crear el primer registro en CounterStock
      await CounterStock.findOneAndUpdate(
        { idArticulo, tipo: categoria }, // Filtro para buscar el registro existente
        { lastCountDate: reqEnd.format(), stock: stockAnterior + stockRangeDates }, // Datos a actualizar
        { upsert: true, new: true } // upsert: true crea el registro si no existe; new: true devuelve el documento actualizado
      );
    }

    return res.json({ stockAnterior, stockRangeDates, listMovimientos });
  } catch (error) {
    console.error('Error al obtener movimientos:', error);
    return res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

router.get('/informe-general-movimientos', async (req, res) => {
  try {
    const { fechaInicio, fechaFin, categoria } = req.query;
    if (!fechaInicio || !fechaFin || !categoria) {
      return res.status(400).json({
        error: 'Faltan parámetros requeridos: fechaInicio, fechaFin y categoria',
      });
    }

    // Conversión de fechas...
    const reqStart = moment(fechaInicio, 'YYYY-MM-DD').startOf('day');
    const reqEnd = moment(fechaFin, 'YYYY-MM-DD').set({
      hour: moment().hour(),
      minute: moment().minute(),
      second: moment().second(),
    });

    const baseline = moment('1900-01-01', 'YYYY-MM-DD');

    let Model, dateField, idField, ArticleModel;
    if (categoria === 'producto') {
      Model = MovimientoProducto;
      dateField = 'dateRegistro';
      idField = 'idProducto';
      ArticleModel = Producto;
    } else if (categoria === 'insumo') {
      Model = MovimientoInsumo;
      dateField = 'infoRegistro.fecha';
      idField = 'idInsumo';
      ArticleModel = Insumo;
    } else {
      return res.status(400).json({ error: 'La categoría debe ser "producto" o "insumo"' });
    }

    // 1. Consultar todos los artículos
    const articles = await ArticleModel.find({}, { _id: 1, nombre: 1 }).lean();

    // 2. Consultar todos los registros de CounterStock
    const allCounters = await CounterStock.find({ tipo: categoria }).lean();
    const countersMap = mapObjectByKey(allCounters, 'idArticulo');

    // Acciones esperadas según la categoría
    const expectedActions =
      categoria === 'producto'
        ? ['abastecimiento', 'desabastecimiento', 'venta', 'anulacion']
        : ['abastecimiento', 'consumo'];

    // Procesar cada artículo (usando Promise.all para esperar todas las operaciones asíncronas)
    const results = await Promise.all(
      articles.map(async (articulo) => {
        const idArticulo = articulo._id.toString();

        // Variables a retornar
        let stockAnterior = 0;
        let stockRangeDates = 0;
        let listMovimientos = [];

        const previousCounter = countersMap[idArticulo];
        if (previousCounter) {
          const prevDate = moment(previousCounter.lastCountDate);
          const prevStock = previousCounter.stock;

          // Caso 3: Rango solicitado completamente posterior al último contador
          if (reqStart.isAfter(prevDate)) {
            let stockFaltante = 0;
            const infoMovimientos = await getMovementsByArticuloList(
              Model,
              idField,
              idArticulo,
              dateField,
              prevDate,
              reqEnd
            );
            listMovimientos = infoMovimientos.filter((mov) => {
              const movDate = moment(getNestedValue(mov, dateField));
              return movDate.isBetween(reqStart, reqEnd, null, '[]');
            });

            // Separamos los movimientos en función de la fecha
            infoMovimientos.forEach((mov) => {
              const movDate = moment(getNestedValue(mov, dateField));

              if (movDate.isBetween(prevDate, reqStart.clone().subtract(1, 'days'), null, '[]')) {
                stockFaltante += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
              } else {
                stockRangeDates += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
              }
            });

            stockAnterior = prevStock + stockFaltante;

            // Actualizar CounterStock con la suma de lo anterior y el rango
            await CounterStock.findOneAndUpdate(
              { _id: previousCounter._id },
              { lastCountDate: reqEnd.format(), stock: stockAnterior + stockRangeDates }
            );
          }
          // Caso 1: El rango solicitado se extiende antes y después del último contador
          else if (reqStart.isSameOrBefore(prevDate) && reqEnd.isAfter(prevDate)) {
            const infoMovimientos = await getMovementsByArticuloList(
              Model,
              idField,
              idArticulo,
              dateField,
              reqStart,
              reqEnd
            );
            listMovimientos = infoMovimientos;
            stockRangeDates = listMovimientos.reduce(
              (total, mov) => (mov.tipo === 'positivo' ? total + mov.cantidad : total - mov.cantidad),
              0
            );

            let diferencial = 0;

            // Separamos los movimientos en función de la fecha
            infoMovimientos.forEach((mov) => {
              const movDate = moment(getNestedValue(mov, dateField));
              // Movimientos después de reqEnd
              if (movDate.isBetween(reqStart, prevDate, null, '[]')) {
                diferencial += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
              }
            });

            stockAnterior = prevStock - diferencial;

            // Actualizar CounterStock con la suma de lo anterior y el rango
            await CounterStock.findOneAndUpdate(
              { _id: previousCounter._id },
              { lastCountDate: reqEnd.format(), stock: stockAnterior + stockRangeDates }
            );
          }
          // Caso 2: El rango solicitado está completamente dentro de lo ya contado (reqEnd <= prevDate)
          else if (reqEnd.isSameOrBefore(prevDate)) {
            // Obtenemos los movimientos entre reqStart y prevDate
            const infoMovimientos = await getMovementsByArticuloList(
              Model,
              idField,
              idArticulo,
              dateField,
              reqStart,
              prevDate
            );

            // Filtramos para obtener solo los movimientos en el rango [reqStart, reqEnd]
            listMovimientos = infoMovimientos.filter((mov) => {
              const movDate = moment(getNestedValue(mov, dateField));
              return movDate.isBetween(reqStart, reqEnd, null, '[]');
            });

            // Inicializamos los acumuladores
            let stockDespues = 0;

            // Separamos los movimientos en función de la fecha
            infoMovimientos.forEach((mov) => {
              const movDate = moment(getNestedValue(mov, dateField));
              // Movimientos después de reqEnd
              if (movDate.isAfter(reqEnd)) {
                stockDespues += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
              } else if (movDate.isBetween(reqStart, reqEnd, null, '[]')) {
                // Movimientos entre reqStart y reqEnd (inclusive)
                stockRangeDates += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
              }
            });

            // Se asume que prevStock es el stock previamente registrado hasta reqStart
            stockAnterior = prevStock - (stockRangeDates + stockDespues);
          }
        } else {
          // Caso 4: No existe registro previo en CounterStock
          const infoMovimientos = await getMovementsByArticuloList(
            Model,
            idField,
            idArticulo,
            dateField,
            baseline,
            reqEnd
          );
          // Filtramos para obtener solo los movimientos en el rango reqStart y reqEnd (inclusive)
          listMovimientos = infoMovimientos.filter((mov) => {
            const movDate = moment(getNestedValue(mov, dateField));
            return movDate.isBetween(reqStart, reqEnd, null, '[]');
          });

          // Separamos los movimientos en función de la fecha
          infoMovimientos.forEach((mov) => {
            const movDate = moment(getNestedValue(mov, dateField));
            if (movDate.isBefore(reqStart)) {
              // Movimientos anteriores a reqStart
              stockAnterior += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
            } else {
              // Movimientos entre reqStart y reqEnd (incluyendo reqStart)
              stockRangeDates += mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad;
            }
          });

          // Busca si existe si no Crear el primer registro en CounterStock
          await CounterStock.findOneAndUpdate(
            { idArticulo, tipo: categoria }, // Filtro para buscar el registro existente
            { lastCountDate: reqEnd.format(), stock: stockAnterior + stockRangeDates }, // Datos a actualizar
            { upsert: true, new: true } // upsert: true crea el registro si no existe; new: true devuelve el documento actualizado
          );
        }

        const infoExtra = expectedActions.map((action) => {
          const movimientosAccion = listMovimientos.filter((mov) => mov.accion === action);
          const totalCantidad = movimientosAccion.reduce((total, mov) => {
            return total + (mov.tipo === 'positivo' ? mov.cantidad : -mov.cantidad);
          }, 0);

          return {
            nombre: action,
            cantidad: totalCantidad,
          };
        });

        return {
          nombre: articulo.nombre,
          stockAnterior,
          stockRangeDates,
          infoExtra,
        };
      })
    );

    return res.json(results);
  } catch (error) {
    console.error('Error en informe general de movimientos:', error);
    return res.status(500).json({ error: 'Error en informe general de movimientos' });
  }
});

export default router;
