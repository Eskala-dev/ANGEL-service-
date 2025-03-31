import mongoose from 'mongoose';
import { currentDate } from '../../../utils/utilsFuncion.js';

// Schema principal
const movimientosInsumoSchema = new mongoose.Schema(
  {
    idInsumo: { type: String, required: true, index: true },
    accion: {
      type: String,
      enum: ['abastecimiento', 'consumo'],
      required: true,
    },
    detalle: { type: String },
    cantidad: { type: Number, required: true },
    tipo: {
      type: String,
      enum: ['positivo', 'negativo'],
      required: true,
    },
    infoRegistro: {
      id: { type: String, required: true },
      fecha: { type: Date, default: currentDate, required: true },
      tipo: { type: String, enum: ['usuario', 'personal'], required: true },
      responsable: { type: String, required: true },
    },
  },
  { collection: 'movimientosInsumo' }
);

const MovimientoInsumo = mongoose.model('movimientosInsumo', movimientosInsumoSchema);

export default MovimientoInsumo;
