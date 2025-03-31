import mongoose from 'mongoose';

// Schema principal
const counterStockSchema = new mongoose.Schema({
  lastCountDate: { type: Date, required: true },
  tipo: {
    type: String,
    enum: ['producto', 'insumo'],
    required: true,
  },
  idArticulo: { type: String, required: true, index: true },
  stock: { type: Number, required: true },
});

const CounterStock = mongoose.model('counterStock', counterStockSchema, 'counterStock');

export default CounterStock;
