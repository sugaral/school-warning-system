import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/clazz/' + url, ...arg)

export default {
	clazzPage(data) {
		return request('page', data, 'get')
	},
	clazzList(data) {
		return request('list', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	clazzDelete(data) {
		return request('delete', data)
	},
	clazzDetail(data) {
		return request('detail', data, 'get')
	},
	orgTreeSelector(data) {
		return request('orgTreeSelector', data, 'get')
	},
	userSelector(data) {
		return request('userSelector', data, 'get')
	}
}
