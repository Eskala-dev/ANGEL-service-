import mongoose from 'mongoose';

const servicioSchema = new mongoose.Schema(
  {
    idOrden: { type: String, required: true },
    codigoOrden: { type: String, required: true },
  },
  { _id: false }
);

const directoSchema = new mongoose.Schema(
  {
    motivo: { type: String, required: true },
  },
  { _id: false }
);

const clienteSchema = new mongoose.Schema({
  dni: {
    type: String,
    default: null,
    required: false,
  },
  nombre: {
    type: String,
    default: null,
    required: true,
  },
  direccion: {
    type: String,
    default: null,
    required: false,
  },
  phone: {
    type: String,
    default: null,
    required: false,
  },
  infoScore: {
    type: [
      {
        puntos: { type: Number, default: 0, required: true },
        dateRegistro: { type: Date, required: true },
        tipoPuntaje: {
          type: String,
          enum: ['positivo', 'negativo'],
          required: true,
        },
        medioRegistro: {
          type: String,
          enum: ['servicio', 'directo'],
          required: true,
        },
        info: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
          required: true,
        },
      },
    ],
    default: [], // Siempre será un array vacío si no se proporcionan datos
    required: false,
  },
  scoreTotal: {
    type: Number,
    default: 0,
    required: true,
  },
});

// Middleware para validar el campo "info" en cada elemento de infoScore antes de guardar
clienteSchema.pre('save', function (next) {
  try {
    if (this.infoScore && this.infoScore.length > 0) {
      this.infoScore.forEach((entry) => {
        if (entry.medioRegistro === 'servicio') {
          // Validar directamente sin intentar crear una instancia
          if (!servicioSchema.obj.hasOwnProperty('idOrden') || !servicioSchema.obj.hasOwnProperty('codigoOrden')) {
            throw new Error(`Datos en "info" no válidos para servicio: ${JSON.stringify(entry.info)}`);
          }
        } else if (entry.medioRegistro === 'directo') {
          // Validar directamente sin intentar crear una instancia
          if (!directoSchema.obj.hasOwnProperty('motivo')) {
            throw new Error(`Datos en "info" no válidos para directo: ${JSON.stringify(entry.info)}`);
          }
        } else {
          throw new Error(
            `Datos en "info" no válidos para la acción y tipo especificados: ${JSON.stringify(entry.info)}`
          );
        }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Índices de texto para búsquedas eficientes
clienteSchema.index({ dni: 'text', nombre: 'text', phone: 'text' });

const clientes = mongoose.model('clientes', clienteSchema);

export default clientes;
