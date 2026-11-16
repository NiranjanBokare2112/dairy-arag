// "/" has no page of its own (owner request, D-44): it sends each role to its start page —
// owner → dashboard, operator → milk collection. The logo and old "#/" links land here.
import { navigate } from '../core/router.js';

export const startPage = (role) => (role === 'owner' ? '/dashboard' : role === 'farmer' ? '/my' : role === 'support' ? '/support' : '/collection');

export default {
  title: 'brand.name',
  async render(el, { user }) {
    navigate(startPage(user.role));
  },
};
