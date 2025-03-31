import mongoose from 'mongoose';

const NegocioSchema = new mongoose.Schema(
  {
    name: String,
    direccion: String,
    contacto: [
      {
        numero: String,
        index: Number,
      },
    ],
    itemsAtajos: Array,
    itemsInformeDiario: Array,
    rolQAnulan: Array,
    funcionamiento: {
      horas: {
        inicio: String,
        fin: String,
      },
      actividad: Boolean,
    },
    horario: [
      {
        horario: String,
        index: Number,
      },
    ],
    oldOrder: Boolean,
    hasMobility: Boolean,
    filterListDefault: String, // others , pendiente
    maxConsultasDefault: Number,
    registroEstricto: Boolean,
    rolQActualizanPagos: Array,
    isReservation: Boolean,
    typeSavedOnCuadre: {
      type: String,
      enum: ['last', 'user'],
      default: 'last',
      required: true,
    },
    orderInListPrincial: Array,
    messageToEstadoLavado: Array,
    messageToOrderSevice: Array,
    tipoWhatsapp: {
      type: String,
      enum: ['web', 'app'],
      default: 'web',
      required: true,
    },
    sizePapper: {
      type: String,
      enum: ['large', 'small'],
      default: 'large',
      required: true,
    },
    showDescription: Boolean,
    showDescuentoDirectoOnTicket: Boolean,
    showMontoTicketProduccion: Boolean,
    showFactura: Boolean,
    multipleSessiones: Boolean,
    rolQExoneranPagos: Array,
    //
    detailPago: Boolean,
    cajaInicialBlocked: Boolean,
    useInsumos: Boolean,
    useProductos: Boolean,
    useAsistencias: Boolean,
    useInformeEntrega: Boolean,
    hourDefaultDatePrevista: String,
  },
  { collection: 'Negocio' }
);

const Negocio = mongoose.model('Negocio', NegocioSchema);

export default Negocio;
