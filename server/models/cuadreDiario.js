import mongoose from 'mongoose';
import { currentDate } from '../utils/utilsFuncion.js';

const infoSuggestionSchema = new mongoose.Schema(
  {
    idCuadre: { type: String, required: true },
    cajaInicialSugerida: { type: Number, required: true },
    fechaCuadre: { type: Date, required: true },
    responsable: { type: String, required: true },
  },
  { _id: false }
);

const cuadreDiarioSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    date: { type: Date, default: currentDate, required: true },
    cajaInicial: { type: Number, required: true },
    suggestion: {
      estado: Boolean,
      info: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
    incuerencia: { type: Boolean },
    Montos: Array,
    estado: {
      type: String,
      enum: ['Sobra', 'Falta', 'Cuadro'],
      required: true,
    },
    margenError: { type: Number, required: true },
    corte: { type: Number, required: true },
    cajaFinal: { type: Number, required: true },
    ingresos: {
      efectivo: { type: Number, required: true },
      tarjeta: { type: Number, required: true },
      transferencia: { type: Number, required: true },
    },
    egresos: { type: Number, required: true },
    notas: [],
    Pagos: [],
    Gastos: [],
    // ----------------------------------------------
    savedBy: {
      idUsuario: { type: String, required: true },
      nombre: { type: String, required: true },
    },
    savedInNameOf: {
      idUsuario: { type: String, required: true },
      nombre: { type: String, required: true },
    },
    tipoGuardado: {
      type: String,
      enum: ['last', 'user'],
      required: true,
    },
  },
  { collection: 'CuadreDiario' }
);

// Middleware para validar el campo "info" y ajustar el "estadoItem"
cuadreDiarioSchema.pre('save', function (next) {
  try {
    // Validar y transformar el campo "info"
    if (this.suggestion.estado) {
      this.info = new mongoose.model('infoSuggestion', infoSuggestionSchema)(this.info).toObject();
    } else if (!this.suggestion.estado) {
      this.info = null;
    } else {
      throw new Error('Movimiento no valido');
    }

    next();
  } catch (error) {
    next(error);
  }
});

const CuadreDiario = mongoose.model('CuadreDiario', cuadreDiarioSchema);

export default CuadreDiario;
