import mongoose from 'mongoose';
import { currentDate } from '../../../utils/utilsFuncion.js';

// Esquemas
const ventaOrAnulacionSchema = new mongoose.Schema(
  {
    idOrden: { type: String, required: true },
    codOrden: { type: String, required: true },
  },
  { _id: false }
);

// Schema principal
const movimientosProductoSchema = new mongoose.Schema({
  idProducto: { type: String, required: true, index: true },
  dateRegistro: { type: Date, default: currentDate, required: true },
  accion: {
    type: String,
    enum: ['abastecimiento', 'desabastecimiento', 'venta', 'anulacion'],
    required: true,
  },
  cantidad: { type: Number, required: true },
  tipo: {
    type: String,
    enum: ['positivo', 'negativo'],
    required: true,
  },
  info: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
});

// Middleware para validar el campo "info" y ajustar el "estadoItem"
movimientosProductoSchema.pre('save', function (next) {
  try {
    // Validar y transformar el campo "info"
    if (this.accion === 'anulacion' || this.accion === 'venta') {
      this.info = new mongoose.model('VentaOrAnulacion', ventaOrAnulacionSchema)(this.info).toObject();
    } else if (this.accion === 'abastecimiento' || this.accion === 'desabastecimiento') {
      this.info = null;
    } else {
      throw new Error('Movimiento no valido');
    }

    next();
  } catch (error) {
    next(error);
  }
});

const MovimientoProducto = mongoose.model('movimientosProducto', movimientosProductoSchema, 'movimientosProducto');

export default MovimientoProducto;
