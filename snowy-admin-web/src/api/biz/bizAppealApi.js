import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/appeal/' + url, ...arg)

export default {
	appealPage(data) {
		return request('page', data, 'get')
	},
	appealAdd(data) {
		return request('add', data)
	},
	appealHandle(data) {
		return request('handle', data)
	},
	appealDelete(data) {
		return request('delete', data)
	},
	appealDetail(data) {
		return request('detail', data, 'get')
	}
}
