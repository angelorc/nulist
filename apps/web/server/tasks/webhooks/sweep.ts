import { useServices } from '../../utils/services'

export default defineTask({
  meta: {
    name: 'webhooks:sweep',
    description: 'Restart the delivery of webhooks no worker is draining'
  },
  async run() {
    return { result: await useServices().webhookSweep.run() }
  }
})
