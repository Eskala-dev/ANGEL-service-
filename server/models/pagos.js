import mongoose from 'mongoose';

const pagosSchema = new mongoose.Schema({
  idOrden: String,
  date: {
    fecha: String,
    hora: String,
  },
  metodoPago: String, // Efectivo | Tarjeta |  OTROS METODOS QUE NO SE ESPECIFICAN
  total: Number,
  idUser: String,
  isCounted: Boolean,
  detail: String,
});

const Pagos = mongoose.model('pagos', pagosSchema);

export default Pagos;
