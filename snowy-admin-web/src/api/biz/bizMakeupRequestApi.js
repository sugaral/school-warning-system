import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/makeuprequest/' + url, ...arg)

export default {
	makeupRequestPage(data) {
		return request('page', data, 'get')
	},
	makeupRequestAdd(data) {
		return request('add', data)
	},
	makeupRequestApprove(data) {
		return request('approve', data)
	},
	makeupRequestDelete(data) {
		return request('delete', data)
	},
	makeupRequestDetail(data) {
		return request('detail', data, 'get')
	}
}
