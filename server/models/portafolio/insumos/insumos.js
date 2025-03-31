import mongoose from 'mongoose';
import { currentDate } from '../../../utils/utilsFuncion.js';

const InsumosSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true },
    stock: { type: Number, required: true, default: 0 },
    notifyMinStock: { type: Number, required: true },
    idCategoria: { type: String, required: true },
    dateCreation: { type: Date, default: currentDate, required: true },
    estado: { type: Boolean, default: true },
    simboloMedida: { type: String, required: true },
  },
  { collection: 'Insumos' }
);

const Insumos = mongoose.model('Insumos', InsumosSchema);

export default Insumos;
