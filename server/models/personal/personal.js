import mongoose from 'mongoose';

const infoSchema = new mongoose.Schema(
  {
    horaIngreso: String,
    horaSalida: String,
    pagoByHour: Number,
    dateNacimiento: String,
    birthDayUsed: { type: Array, default: [] },
    pagoMensual: Number,
  },
  { _id: false }
);

const personalSchema = new mongoose.Schema({
  name: { type: String, required: true },
  tipo: {
    type: String,
    enum: ['interno', 'externo'],
    required: true,
  },
  idRolPersonal: { type: String, required: true },
  info: {
    type: mongoose.Schema.Types.Mixed,
    required: function () {
      return this.tipo === 'interno';
    },
  },
});

// Middleware para validar y ajustar "info"
personalSchema.pre('save', function (next) {
  try {
    if (this.tipo === 'interno' && this.info) {
      // Crear una instancia de InfoModel sólo si el tipo es "interno"
      this.info = new mongoose.model('InfoModel', infoSchema)(this.info).toObject();
    } else if (this.tipo === 'externo') {
      this.info = null;
    }
    next();
  } catch (error) {
    next(error);
  }
});

const Personal = mongoose.model('Personal', personalSchema);

export default Personal;
