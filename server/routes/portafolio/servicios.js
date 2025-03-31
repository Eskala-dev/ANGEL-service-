import express from 'express';
import Servicio from '../../models/portafolio/servicios.js';
import Categoria from '../../models/categorias.js';
import Promocion from '../../models/promociones.js';
import moment from 'moment'; // Importa moment para trabajar con fechas
import { nameDelivery } from '../../utils/varsGlobal.js';

const router = express.Router();

router.post('/add-servicio', (req, res) => {
  const { nombre, idCategoria, precioVenta, simboloMedida, estado } = req.body;

  // Agrega la fecha de creación actual
  const dateCreation = moment().format('YYYY-MM-DD');

  const newProducto = new Servicio({
    nombre,
    idCategoria,
    precioVenta,
    dateCreation,
    simboloMedida,
    estado,
  });

  newProducto
    .save()
    .then((servicioGuardado) => {
      res.json({
        tipoAction: 'added',
        data: servicioGuardado,
      });
    })
    .catch((error) => {
      console.error('Error al Crear servicio:', error);
      res.status(500).json({ mensaje: 'Error al Crear servicio' });
    });
});

router.get('/get-servicios', async (req, res) => {
  try {
    // Obtener todos los servicios
    const servicios = await Servicio.find();

    // Extraer los ids de las categorías de todos los servicios
    const categoriaIds = servicios.map((servicio) => servicio.idCategoria);

    // Obtener todas las categorías relacionadas en una sola consulta
    const categorias = await Categoria.find({ _id: { $in: categoriaIds } });

    // Crear un objeto para buscar categorías más rápido
    const categoriaMap = categorias.reduce((acc, categoria) => {
      acc[categoria._id] = categoria;
      return acc;
    }, {});

    // Variable para almacenar el servicio que coincida con las condiciones
    let servicioDelivery = null;
    let servicioOtros = null;

    // Recorrer cada servicio
    for (const servicio of servicios) {
      const categoria = categoriaMap[servicio.idCategoria];

      // Validar que exista la categoría y cumpla con las condiciones requeridas
      if (categoria && categoria.name === 'Unico' && categoria.nivel === 'primario') {
        if (servicio.nombre === 'Otros') {
          servicioOtros = servicio;
        } else if (servicio.nombre === nameDelivery) {
          servicioDelivery = servicio;
        }
      }

      // Romper la búsqueda solo si ambos servicios han sido encontrados
      if (servicioDelivery && servicioOtros) {
        break;
      }
    }

    // Enviar los datos
    res.json({ servicios, servicioDelivery, servicioOtros });
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).json({ mensaje: 'Error al obtener servicios' });
  }
});

router.put('/update-servicio/:idServicio', async (req, res) => {
  const { idServicio } = req.params;
  const { nombre, idCategoria, precioVenta, simboloMedida, estado } = req.body;

  try {
    const updatedServicio = await Servicio.findOneAndUpdate(
      { _id: idServicio },
      { $set: { nombre, idCategoria, precioVenta, simboloMedida, estado } },
      { new: true }
    );

    if (updatedServicio) {
      return res.json({
        tipoAction: 'updated',
        data: updatedServicio,
      });
    } else {
      return res.status(404).json({ mensaje: 'No se encontró el servicio' });
    }
  } catch (error) {
    console.error('Error al actualizar servicio:', error);
    res.status(500).json({ mensaje: 'Error al actualizar servicio' });
  }
});

router.delete('/delete-servicio/:idServicio', async (req, res) => {
  const { idServicio } = req.params;

  try {
    // Verificar si el servicio está siendo usado en Promociones con alcance distinto de "Todos"
    const promocionesConServicio = await Promocion.find(
      { prenda: idServicio, alcance: { $ne: 'Todos' } },
      { _id: 1, codigo: 1 }
    );

    if (promocionesConServicio.length > 0) {
      const codigos = promocionesConServicio.map((promocion) => promocion.codigo);
      return res.status(400).json({
        mensaje: 'No se puede eliminar el servicio porque está siendo utilizado en una o mas promociones.',
        codigos,
      });
    }

    // Si el servicio no está siendo usado en promociones, procede a eliminarlo
    const servicioEliminado = await Servicio.findByIdAndRemove(idServicio);

    if (servicioEliminado) {
      return res.json({
        tipoAction: 'deleted',
        data: {
          _id: servicioEliminado._id,
        },
      });
    } else {
      return res.status(404).json({ mensaje: 'Servicio no encontrado' });
    }
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    res.status(500).json({ mensaje: 'Error al eliminar servicio' });
  }
});

export default router;
