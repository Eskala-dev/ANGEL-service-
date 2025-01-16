import mongoose from 'mongoose';
import { currentDate } from '../../../utils/utilsFuncion.js';

const ProductoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true },
    idCategoria: { type: String, required: true },
    precioVenta: { type: Number, required: true },
    dateCreation: { type: Date, default: currentDate, required: true },
    simboloMedida: { type: String, required: true },
    stockPrincipal: { type: Number, required: true, default: 0 },
    estado: { type: Boolean, default: true },
    notifyMinStock: { type: Number, required: true },
  },
  { collection: 'Producto' }
);

const Producto = mongoose.model('Producto', ProductoSchema);

export default Producto;
