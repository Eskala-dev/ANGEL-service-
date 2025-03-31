import mongoose from 'mongoose';

const gastoSchema = new mongoose.Schema(
  {
    idTipoGasto: String,
    tipo: String,
    motivo: String,
    date: {
      fecha: String,
      hora: String,
    },
    monto: String,
    idUser: String,
    metodoGasto: String, // Efectivo | Tarjeta |  OTROS METODOS QUE NO SE ESPECIFICAN
  },
  { collection: 'Gastos' }
);

const Gasto = mongoose.model('Gasto', gastoSchema);

export default Gasto;
