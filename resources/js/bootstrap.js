import '../css/app.css';
import 'bootstrap/dist/css/bootstrap.min.css'; // si querés usar Bootstrap (opcional)
import axios from 'axios';

window.axios = axios;
window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
