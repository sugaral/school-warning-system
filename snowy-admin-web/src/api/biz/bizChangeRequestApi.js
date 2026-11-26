import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/changerequest/' + url, ...arg)

export default {
	changeRequestPage(data) {
		return request('page', data, 'get')
	},
	changeRequestAdd(data) {
		return request('add', data)
	},
	changeRequestApprove(data) {
		return request('approve', data)
	},
	changeRequestDelete(data) {
		return request('delete', data)
	},
	changeRequestDetail(data) {
		return request('detail', data, 'get')
	}
}
