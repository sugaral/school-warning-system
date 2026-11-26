import { baseRequest } from '@/utils/request'

export default {
	dashboard(data) {
		return baseRequest('/biz/stats/dashboard', data, 'get')
	}
}
