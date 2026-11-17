import { useServices } from '../../utils/services'

export default defineTask({
  meta: {
    name: 'segments:sync',
    description: 'Sync segment memberships of every organization'
  },
  async run() {
    return { result: await useServices().segmentSync.run() }
  }
})
