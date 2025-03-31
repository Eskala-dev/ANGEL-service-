import express from 'express';
import Producto from '../../models/portafolio/productos/productos.js';
import Categoria from '../../models/categorias.js';
import Servicio from '../../models/portafolio/servicios.js';
import Negocio from '../../models/negocio.js';
import Factura from '../../models/Factura.js';
import moment from 'moment';

const router = express.Router();

router.get('/get-informacion/:fecha', async (req, res) => {
  try {
    const date = req.params.fecha;

    if (!date) {
      return res.status(400).json({ mensaje: 'Se requiere proporcionar una fecha' });
    }

    const dateFormat = moment(date, 'YYYY-MM-DD');
    const inicioMes = moment(dateFormat).startOf('month').format('YYYY-MM-DD');
    const finMes = moment(dateFormat).endOf('month').format('YYYY-MM-DD');

    // Obtener la configuración de Negocio
    const negocio = await Negocio.findOne({}, 'useProductos').lean();
    const useProductos = negocio?.useProductos;

    // Obtener solo los servicios si useProductos es false
    const servicios = await Servicio.find({}, 'nombre simboloMedida idCategoria _id').lean();
    const productos = useProductos ? await Producto.find({}, 'nombre simboloMedida idCategoria _id').lean() : [];

    // Asignar tipo a cada elemento
    const infoServicios = servicios.map((servicio) => ({ ...servicio, tipo: 'servicios' }));
    const infoProductos = useProductos ? productos.map((producto) => ({ ...producto, tipo: 'productos' })) : [];

    // Unificar productos y servicios
    const infoPortafolio = [...infoServicios, ...infoProductos];

    // Obtener categorías
    const infoCategorias = await Categoria.find({}, 'name _id nivel').lean();

    // Obtener la categoría primaria y el servicio "Otros"
    const categoriaPrimaria = infoCategorias.find((cat) => cat.nivel === 'primario');
    let servicioOtros = null;

    if (categoriaPrimaria) {
      servicioOtros = servicios.find((s) => s.idCategoria === categoriaPrimaria._id.toString() && s.nombre === 'Otros');
    }

    // Definir el filtro de facturas dinámicamente
    const filtroFacturas = {
      'infoRecepcion.fecha': { $gte: inicioMes, $lte: finMes },
      estadoPrenda: { $nin: ['anulado', 'donado'] },
    };

    // Si useProductos es false, solo traer servicios
    if (!useProductos) {
      filtroFacturas['Items.tipo'] = 'servicio';
    }

    // Consultar facturas con el filtro dinámico
    const facturas = await Factura.find(filtroFacturas, {
      _id: 1,
      'Items.identificador': 1,
      'Items.item': 1,
      'Items.tipo': 1,
      'Items.cantidad': 1,
      'Items.total': 1,
    }).lean();

    // Mapeo de datos de portafolio
    const portafolioMap = {};
    let datosOtros = {}; // Objeto para almacenar los datos de "Otros"

    // Iterar sobre las facturas
    for (const factura of facturas) {
      for (const item of factura.Items) {
        // Encontrar el producto o servicio en el portafolio
        const itemPortafolio = infoPortafolio.find((ip) => ip._id.toString() === item.identificador);

        if (itemPortafolio) {
          const id = itemPortafolio._id.toString();
          portafolioMap[id] ??= {
            nombre: itemPortafolio.nombre,
            _id: itemPortafolio._id,
            categoria: infoCategorias.find((cat) => cat._id.toString() === itemPortafolio.idCategoria),
            tipo: itemPortafolio.tipo,
            cantidad: 0,
            simboloMedida: itemPortafolio.simboloMedida,
            montoGenerado: 0,
          };

          const cantidad = Number(item.cantidad);
          const total = Number(item.total);
          if (!isNaN(cantidad) && !isNaN(total)) {
            portafolioMap[id].cantidad += cantidad;
            portafolioMap[id].montoGenerado += total;
          } else {
            console.log('Cantidad o Total no son valores numéricos válidos en ORDEN CON ID : ', factura._id);
          }
        }

        // Si el item es "Otros", agregarlo al objeto datosOtros
        if (servicioOtros && item.identificador === servicioOtros._id.toString()) {
          const nombreItem = item.item;

          datosOtros[nombreItem] ??= {
            nombre: nombreItem,
            _id: servicioOtros._id,
            categoria: {
              _id: categoriaPrimaria._id,
              name: categoriaPrimaria.name,
              nivel: categoriaPrimaria.nivel,
            },
            tipo: 'otros',
            cantidad: 0,
            simboloMedida: servicioOtros.simboloMedida,
            montoGenerado: 0,
          };

          const cantidad = Number(item.cantidad);
          const total = Number(item.total);

          if (!isNaN(cantidad) && !isNaN(total)) {
            datosOtros[nombreItem].cantidad += cantidad;
            datosOtros[nombreItem].montoGenerado += total;
          }
        }
      }
    }

    // Convertir los datosOtros a un array con la estructura deseada
    const datosOtrosArray = Object.values(datosOtros);

    // Convertir el mapa a un arreglo de objetos
    const infoFinalPortafolio = Object.values(portafolioMap);

    res.json({ infoFinalPortafolio, datosOtros: datosOtrosArray });
  } catch (error) {
    console.error('Error al obtener la información Portafolio:', error);
    res.status(500).json({ mensaje: 'Error al obtener la información Portafolio' });
  }
});

export default router;
