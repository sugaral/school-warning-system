import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/workbench/' + url, ...arg)

export default {
	overview(data) {
		return request('overview', data, 'get')
	},
	getNotificationStrategy(data) {
		return request('notificationStrategy', data, 'get')
	},
	saveNotificationStrategy(data) {
		return request('notificationStrategy/save', data)
	},
	specialApproveChange(data) {
		return request('specialApproveChange', data)
	}
}
