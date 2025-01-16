import mongoose from 'mongoose';

const facturaSchema = new mongoose.Schema({
  dateCreation: Date,
  codRecibo: String,
  infoRecepcion: {
    tipo: String, // usuario | personal
    id: String,
    fecha: Date,
    responsable: String,
  },
  delivery: Boolean,
  Nombre: String,
  idCliente: String,
  Items: [
    {
      identificador: String,
      tipo: String,
      item: String,
      simboloMedida: String,
      cantidad: Number,
      descripcion: String,
      precioBase: String,
      precioCobrado: String,
      descuentoManual: String,
      subTotal: String,
      total: String,
    },
  ],
  celular: String,
  direccion: String,
  datePrevista: Date,
  infoEntrega: {
    tipo: String, // usuario | personal
    id: String,
    fecha: Date,
    responsable: String,
  },
  descuento: {
    estado: Boolean,
    modoDescuento: String, // Puntos | Promocion | Ninguno
    info: { type: mongoose.Schema.Types.Mixed },
    monto: Number,
  },
  estadoPrenda: String, // entregado | anulado | pendiente | donado
  estado: String, // reservado | registrado
  listPago: [],
  dni: String,
  subTotal: String,
  totalNeto: String,
  cargosExtras: {},
  modeRegistro: String, // nuevo || antiguo
  notas: [],
  gift_promo: [],
  location: Number,
  lastEdit: [],
  typeRegistro: String, // normal
});

const Factura = mongoose.model('Factura', facturaSchema);

export default Factura;
