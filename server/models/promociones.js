import mongoose from 'mongoose';

const PromocionesSchema = new mongoose.Schema(
  {
    codigo: String,
    prenda: Array,
    cantidadMin: Number,
    alcance: String,
    tipoDescuento: String,
    seletionServices: String,
    tipoPromocion: String, // codigo | selection
    descripcion: String,
    descuento: Number,
    vigencia: Number,
    state: String,
  },
  { collection: 'Promocion' }
);

const Promocion = mongoose.model('Promocion', PromocionesSchema);

export default Promocion;
