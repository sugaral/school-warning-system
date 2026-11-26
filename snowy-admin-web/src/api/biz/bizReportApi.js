import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/report/' + url, ...arg)

export default {
	page(data) {
		return request('page', data, 'get')
	},
	exportReport(data) {
		return request('export', data)
	},
	downloadReport(data) {
		return request('download', data, 'get', { responseType: 'blob' })
	},
	deleteReport(data) {
		return request('delete', data)
	}
}
